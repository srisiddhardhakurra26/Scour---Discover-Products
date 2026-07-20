import sharp from 'sharp'
import { prisma } from './db'
import { updateProductAggregates } from './cluster'
import { ocrImageText } from './ocr'
import { hashesMatch, imageDHash } from './phash'
import { fetchSafeRemote } from './url-safety'
import { envFlag } from './env'

// Background image enrichment: one fetch of a listing's product photo feeds
// two signals — a perceptual hash (clustering, ADR-009) and OCR'd spec text.
// Strictly off the search path: persist enqueues ids and returns; a single
// in-process worker drains the queue. Every listing is attempted at most
// once per process; results are persisted so restarts skip finished work.

const attempted = new Set<string>()
const queue: string[] = []
let draining = false

const MAX_QUEUE = 300
const IMAGE_TIMEOUT_MS = 5000
const IMAGE_MAX_BYTES = 3_000_000

export function enqueueEnrichment(listingIds: string[]): void {
  if (envFlag(process.env.ENRICH_DISABLED)) return
  for (const id of listingIds) {
    if (attempted.has(id) || queue.includes(id)) continue
    if (queue.length >= MAX_QUEUE) break
    queue.push(id)
  }
  if (!draining && queue.length > 0) {
    draining = true
    void drain()
  }
}

async function drain(): Promise<void> {
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      attempted.add(id)
      try {
        await enrichOne(id)
      } catch (err) {
        console.warn('[enrich]', err instanceof Error ? err.message : err)
      }
    }
  } finally {
    draining = false
  }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetchSafeRemote(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
    if (!res.ok) return null
    if (!res.headers.get('content-type')?.startsWith('image/')) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > IMAGE_MAX_BYTES) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > IMAGE_MAX_BYTES) return null
    return Buffer.from(buf)
  } catch {
    return null
  }
}

async function enrichOne(id: string): Promise<void> {
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      imageUrl: true,
      imageHash: true,
      ocrText: true,
      priceMinor: true,
      productId: true,
    },
  })
  if (!listing?.imageUrl) return

  const needHash = !listing.imageHash
  // ocrText null = never attempted; '' = attempted, image had no usable text.
  const needOcr = listing.ocrText === null && !envFlag(process.env.ENRICH_OCR_DISABLED)
  if (!needHash && !needOcr) return

  const image = await fetchImage(listing.imageUrl)
  if (!image) return

  let hash = listing.imageHash
  if (needHash) {
    try {
      hash = await imageDHash(image)
      await prisma.listing.update({ where: { id }, data: { imageHash: hash } })
    } catch {
      hash = null // undecodable image — leave unhashed
    }
  }

  if (needOcr) {
    try {
      // Normalize to PNG so tesseract never sees webp/avif it can't decode.
      const png = await sharp(image).png().toBuffer()
      const text = await ocrImageText(png)
      await prisma.listing.update({ where: { id }, data: { ocrText: text ?? '' } })
      if (text) console.log(`[enrich] ocr listing=${id}: "${text.slice(0, 60)}"`)
    } catch {
      await prisma.listing.update({ where: { id }, data: { ocrText: '' } }).catch(() => {})
    }
  }

  if (hash) await maybeMergeByHash(id, hash, listing.productId, listing.priceMinor)
}

/**
 * Late cluster merge on matching product imagery. Hashes arrive after the
 * listing was already clustered by title, so the hash signal is applied
 * retroactively — but only to listings sitting alone in their cluster, so an
 * established multi-listing cluster is never broken by one photo match.
 */
async function maybeMergeByHash(
  listingId: string,
  hash: string,
  productId: string | null,
  priceMinor: number,
): Promise<void> {
  if (productId) {
    const siblings = await prisma.listing.count({ where: { productId } })
    if (siblings > 1) return
  }

  const rows = await prisma.listing.findMany({
    where: { imageHash: { not: null }, productId: { not: null }, id: { not: listingId } },
    select: { imageHash: true, productId: true, priceMinor: true },
  })
  const match = rows.find(
    (r) => r.productId !== productId && hashesMatch(hash, r.imageHash!),
  )
  if (!match?.productId) return

  // Same price guardrail as title clustering: a matching photo with a wildly
  // different price smells like an accessory reusing the hero shot.
  if (priceMinor > 0 && match.priceMinor > 0) {
    const ratio = priceMinor / match.priceMinor
    if (ratio < 0.25 || ratio > 4) return
  }

  await prisma.listing.update({
    where: { id: listingId },
    data: { productId: match.productId },
  })
  await updateProductAggregates(match.productId)
  if (productId) {
    const left = await prisma.listing.count({ where: { productId } })
    if (left === 0) {
      await prisma.product.delete({ where: { id: productId } }).catch(() => {})
    } else {
      await updateProductAggregates(productId)
    }
  }
  console.log(`[enrich] image-hash merge: listing ${listingId} → product ${match.productId}`)
}
