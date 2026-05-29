import { prisma } from '@/lib/db'
import { bytesToFloat, dotProduct, EMBEDDING_DIM } from './embeddings'
import { extractASIN } from './text'

// Bumped from 0.75 → 0.82 to reduce over-clustering. Combined with title
// normalization (embeddings reflect product essence rather than promo copy)
// and the price guardrail below, this gives meaningfully tighter clusters
// without starving the rail of multi-retailer matches.
export const SIMILARITY_THRESHOLD = 0.82

// Reject attaching a listing to a cluster if its price is wildly outside the
// cluster's existing price range. Catches "AirPods Pro case $4.99" being
// mis-attached to a $169 AirPods Pro cluster. Allows used/refurb (down to 25%).
const PRICE_RATIO_LOW = 0.25
const PRICE_RATIO_HIGH = 4.0

type ProductWithListings = {
  id: string
  canonicalTitle: string
  canonicalImage: string | null
  listings: {
    url: string
    priceMinor: number
    textEmbedding: Uint8Array | null
  }[]
}

function centroidOf(embeddings: Float32Array[]): Float32Array {
  const sum = new Float32Array(EMBEDDING_DIM)
  for (const e of embeddings) {
    for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] += e[i]
  }
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += sum[i] * sum[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] /= norm
  return sum
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function priceFits(newPriceMinor: number, clusterPrices: number[]): boolean {
  if (newPriceMinor <= 0) return true
  const validPrices = clusterPrices.filter((p) => p > 0)
  if (validPrices.length === 0) return true
  const m = median(validPrices)
  if (m <= 0) return true
  const ratio = newPriceMinor / m
  return ratio >= PRICE_RATIO_LOW && ratio <= PRICE_RATIO_HIGH
}

async function loadCandidateProducts(): Promise<ProductWithListings[]> {
  return prisma.product.findMany({
    select: {
      id: true,
      canonicalTitle: true,
      canonicalImage: true,
      listings: {
        select: { url: true, priceMinor: true, textEmbedding: true },
      },
    },
  })
}

/** Try to find an existing Product by matching ASIN in URLs. Fast path. */
async function findProductByASIN(asin: string): Promise<string | null> {
  const match = await prisma.listing.findFirst({
    where: {
      productId: { not: null },
      OR: [{ url: { contains: `/dp/${asin}` } }, { url: { contains: asin } }],
    },
    select: { productId: true },
  })
  return match?.productId ?? null
}

/** Attach a listing to its best-matching existing Product, or create a new one. */
export async function clusterListing(
  listingId: string,
  embedding: Float32Array,
): Promise<{ productId: string; created: boolean; similarity: number; reason: string }> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { title: true, url: true, imageUrl: true, priceMinor: true },
  })
  if (!listing) throw new Error(`listing not found: ${listingId}`)

  // --- Pass 1: ASIN exact match (cheap and authoritative when present)
  const asin = extractASIN(listing.url)
  if (asin) {
    const productId = await findProductByASIN(asin)
    if (productId) {
      await prisma.listing.update({ where: { id: listingId }, data: { productId } })
      await updateProductAggregates(productId)
      return { productId, created: false, similarity: 1, reason: `asin:${asin}` }
    }
  }

  // --- Pass 2: cosine similarity over normalized-title embeddings + price sanity
  const candidates = await loadCandidateProducts()
  let best: { product: ProductWithListings; similarity: number } | null = null
  for (const p of candidates) {
    if (p.listings.length === 0) continue
    const embeds = p.listings
      .map((l) => (l.textEmbedding ? bytesToFloat(l.textEmbedding) : null))
      .filter((v): v is Float32Array => v !== null && v.length === EMBEDDING_DIM)
    if (embeds.length === 0) continue
    const c = centroidOf(embeds)
    const sim = dotProduct(embedding, c)
    if (!best || sim > best.similarity) best = { product: p, similarity: sim }
  }

  if (best && best.similarity >= SIMILARITY_THRESHOLD) {
    const prices = best.product.listings.map((l) => l.priceMinor)
    if (priceFits(listing.priceMinor, prices)) {
      await prisma.listing.update({
        where: { id: listingId },
        data: { productId: best.product.id },
      })
      await updateProductAggregates(best.product.id)
      return {
        productId: best.product.id,
        created: false,
        similarity: best.similarity,
        reason: 'cosine+price-ok',
      }
    }
    // Similarity passed but price doesn't fit — likely an accessory/scam.
    // Fall through to create a new product so the cluster stays clean.
  }

  const now = new Date()
  const product = await prisma.product.create({
    data: {
      canonicalTitle: listing.title,
      canonicalImage: listing.imageUrl,
      firstSeenAt: now,
      lastSeenAt: now,
      listingCount: 1,
      retailerCount: 1,
    },
  })
  await prisma.listing.update({
    where: { id: listingId },
    data: { productId: product.id },
  })
  return {
    productId: product.id,
    created: true,
    similarity: best?.similarity ?? 0,
    reason: best && best.similarity >= SIMILARITY_THRESHOLD ? 'price-rejected' : 'no-match',
  }
}

export async function updateProductAggregates(productId: string): Promise<void> {
  const listings = await prisma.listing.findMany({
    where: { productId },
    select: { retailerId: true },
  })
  const retailerCount = new Set(listings.map((l) => l.retailerId)).size
  await prisma.product.update({
    where: { id: productId },
    data: {
      listingCount: listings.length,
      retailerCount,
      lastSeenAt: new Date(),
    },
  })
}
