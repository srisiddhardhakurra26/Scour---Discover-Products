// Text embeddings via @huggingface/transformers running in-process (ONNX).
// Model: Xenova/all-MiniLM-L6-v2 — 384 dims, ~25MB quantized.

import { cache } from 'react'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
export const EMBEDDING_DIM = 384

type Extractor = (input: string | string[], options?: { pooling?: 'mean'; normalize?: boolean }) => Promise<{ data: Float32Array; dims: number[] }>

const globalForEmb = globalThis as unknown as {
  __scourEmbedder?: Promise<Extractor>
}

async function loadModel(): Promise<Extractor> {
  const { pipeline } = await import('@huggingface/transformers')
  // First call downloads & caches model files under node_modules/@huggingface/transformers/.cache or ~/.cache
  const pipe = await pipeline('feature-extraction', MODEL_ID)
  return pipe as unknown as Extractor
}

function getEmbedder(): Promise<Extractor> {
  if (!globalForEmb.__scourEmbedder) {
    globalForEmb.__scourEmbedder = loadModel()
  }
  return globalForEmb.__scourEmbedder
}

/** Embed a single string. Returns a normalized Float32Array of length EMBEDDING_DIM. */
export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await getEmbedder()
  const out = await extractor(text, { pooling: 'mean', normalize: true })
  return out.data
}

/** Batch embed. Returns one Float32Array per input. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const extractor = await getEmbedder()
  const out = await extractor(texts, { pooling: 'mean', normalize: true })
  const flat = out.data
  const result: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    result.push(flat.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM))
  }
  return result
}

/** Cached per-request so multiple AdapterSections share one query embedding. */
export const embedQueryCached = cache(async (query: string): Promise<Float32Array> => {
  return embedText(query)
})

/** Vectors are unit-normalized at embed time, so dot product equals cosine similarity. */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Convert a Float32Array to a byte view suitable for Prisma Bytes columns. */
export function floatToBytes(arr: Float32Array): Uint8Array<ArrayBuffer> {
  // Copy into a fresh ArrayBuffer (not SharedArrayBuffer) so the resulting
  // Uint8Array is typed as Uint8Array<ArrayBuffer>, which is what Prisma's
  // Bytes column expects.
  const out = new Uint8Array(arr.byteLength)
  out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
  return out
}

/** Convert Bytes back to a Float32Array. Works for both Buffer and Uint8Array. */
export function bytesToFloat(bytes: Uint8Array | Buffer): Float32Array {
  // Copy into a fresh ArrayBuffer to guarantee 4-byte alignment for the Float32Array view.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Float32Array(copy.buffer)
}
