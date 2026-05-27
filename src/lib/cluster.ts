import { prisma } from '@/lib/db'
import { bytesToFloat, dotProduct, EMBEDDING_DIM } from './embeddings'

// Threshold tuned for all-MiniLM-L6-v2 normalized embeddings.
// 0.75 lands on "same product, different listing" while rejecting "same category, different product".
// Adjust per category later if needed.
export const SIMILARITY_THRESHOLD = 0.75

type ProductWithEmbeddings = {
  id: string
  canonicalTitle: string
  canonicalImage: string | null
  listings: { textEmbedding: Uint8Array | null }[]
}

/** Compute a unit-normalized centroid from a set of unit-normalized embeddings. */
function centroidOf(embeddings: Float32Array[]): Float32Array {
  const sum = new Float32Array(EMBEDDING_DIM)
  for (const e of embeddings) {
    for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] += e[i]
  }
  // Normalize
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += sum[i] * sum[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] /= norm
  return sum
}

async function loadCandidateProducts(): Promise<ProductWithEmbeddings[]> {
  // V1: scan all products. Replace with category-gated query or vector index when N grows.
  return prisma.product.findMany({
    select: {
      id: true,
      canonicalTitle: true,
      canonicalImage: true,
      listings: {
        where: { textEmbedding: { not: null } },
        select: { textEmbedding: true },
      },
    },
  })
}

/** Attach a listing to its best-matching existing Product, or create a new one. */
export async function clusterListing(
  listingId: string,
  embedding: Float32Array,
): Promise<{ productId: string; created: boolean; similarity: number }> {
  const candidates = await loadCandidateProducts()

  let best: { product: ProductWithEmbeddings; similarity: number } | null = null
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
    await prisma.listing.update({
      where: { id: listingId },
      data: { productId: best.product.id },
    })
    await updateProductAggregates(best.product.id)
    return { productId: best.product.id, created: false, similarity: best.similarity }
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { title: true, imageUrl: true },
  })
  const now = new Date()
  const product = await prisma.product.create({
    data: {
      canonicalTitle: listing?.title ?? 'Unknown product',
      canonicalImage: listing?.imageUrl,
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
  return { productId: product.id, created: true, similarity: best?.similarity ?? 0 }
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
