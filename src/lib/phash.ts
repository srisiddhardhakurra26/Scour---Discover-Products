import sharp from 'sharp'

// Perceptual difference-hash (dHash) of product imagery. Retailers selling
// the same product overwhelmingly reuse the manufacturer's photo, so two
// listings whose image hashes (nearly) match are the same product with
// near-certainty — a far stronger signal than title similarity, at the cost
// of one tiny image decode. 64-bit hash as a 16-char hex string.
// See ADR-009.

const HASH_W = 9
const HASH_H = 8

/** dHash of an image buffer. Throws on undecodable input. */
export async function imageDHash(input: Buffer): Promise<string> {
  const pixels = await sharp(input)
    .grayscale()
    .resize(HASH_W, HASH_H, { fit: 'fill' })
    .raw()
    .toBuffer()

  let hash = 0n
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      hash <<= 1n
      if (pixels[y * HASH_W + x] < pixels[y * HASH_W + x + 1]) hash |= 1n
    }
  }
  return hash.toString(16).padStart(16, '0')
}

/** Hamming distance between two dHash hex strings (0–64). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let count = 0
  while (x > 0n) {
    count += Number(x & 1n)
    x >>= 1n
  }
  return count
}

/** Same-product bar: identical manufacturer photos differ by recompression
 * and resizing, which moves a dHash by a few bits at most. */
export const HASH_MATCH_MAX_DISTANCE = 6

export function hashesMatch(a: string, b: string): boolean {
  return hammingDistance(a, b) <= HASH_MATCH_MAX_DISTANCE
}
