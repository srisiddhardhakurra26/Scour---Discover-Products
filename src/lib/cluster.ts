import { prisma } from '@/lib/db'
import { bytesToFloat, dotProduct, EMBEDDING_DIM } from './embeddings'
import {
  JUDGE_BAND_HIGH,
  JUDGE_BAND_LOW,
  judgeSameProduct,
} from './llm/cluster-judge'
import { hashesMatch } from './phash'
import { extractASIN, meaningfulTokens, normalizeTitle } from './text'

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
    id: string
    title: string
    retailerId: string
    url: string
    priceMinor: number
    textEmbedding: Uint8Array | null
  }[]
}

// Cosine similarity is useful for candidate generation, but it is not product
// identity: "Blundstone 585" and "Blundstone 550" are very similar sentences
// and very different products. Model-like tokens act as a deterministic veto,
// while model-less titles must be near-duplicates before the LLM/cosine stage
// is even allowed to merge them.
const IDENTITY_NOISE = new Set([
  'new', 'used', 'sale', 'mens', 'womens', 'men', 'women', 'size', 'black',
  'brown', 'white', 'blue', 'red', 'gray', 'grey', 'free', 'shipping',
])

export function extractIdentityTokens(title: string): string[] {
  const normalized = normalizeTitle(title).toLowerCase()
  const compound = normalized.match(
    /\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)*\b/g,
  ) ?? []
  const flattened = compound.map((token) => token.replace(/-/g, ''))
  return [
    ...new Set(
      [
        ...flattened,
        ...flattened.map((token) => token.replace(/^[a-z]{1,4}(?=\d)/, '')),
        ...(normalized.match(/\b\d{2,6}\b/g) ?? []),
      ].filter((token) => !/^\d+(?:cm|mm|in|oz|lb|gb|tb|ml)$/.test(token)),
    ),
  ]
}

function identityWords(title: string): Set<string> {
  return new Set(
    meaningfulTokens(normalizeTitle(title))
      .map((token) => (token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token))
      .filter((token) => !IDENTITY_NOISE.has(token)),
  )
}

/** Conservative precondition for semantic/LLM product-entity merging. */
export function identityCompatible(left: string, right: string): boolean {
  const leftIds = extractIdentityTokens(left)
  const rightIds = extractIdentityTokens(right)
  if (leftIds.length > 0 && rightIds.length > 0) {
    return leftIds.some((token) => rightIds.includes(token))
  }

  const a = identityWords(left)
  const b = identityWords(right)
  if (a.size === 0 || b.size === 0) return false
  const overlap = [...a].filter((token) => b.has(token)).length
  const union = new Set([...a, ...b]).size
  return overlap >= 3 && overlap / union >= 0.72
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

async function loadCandidateProducts(
  excludeListingIds: string | string[],
): Promise<ProductWithListings[]> {
  const excluded = Array.isArray(excludeListingIds)
    ? excludeListingIds
    : [excludeListingIds]
  const excludedSet = new Set(excluded)
  const products = await prisma.product.findMany({
    select: {
      id: true,
      canonicalTitle: true,
      canonicalImage: true,
      listings: {
        select: {
          id: true,
          title: true,
          retailerId: true,
          url: true,
          priceMinor: true,
          textEmbedding: true,
        },
      },
    },
  })
  // Filtering a large maintenance batch through SQL's NOT IN can exceed
  // SQLite's bind-parameter limit. The bounded local catalogue is cheap to
  // filter in memory and the request path normally excludes only one row.
  return products.map((product) => ({
    ...product,
    listings: product.listings.filter((listing) => !excludedSet.has(listing.id)),
  }))
}

/** Try to find an existing Product by matching ASIN in URLs. Fast path. */
async function findProductByASIN(
  asin: string,
  excludeListingId: string,
  retailerId: string,
  claimedProductIds: Set<string>,
): Promise<string | null> {
  const matches = await prisma.listing.findMany({
    where: {
      id: { not: excludeListingId },
      productId: { not: null },
      OR: [{ url: { contains: `/dp/${asin}` } }, { url: { contains: asin } }],
    },
    select: { productId: true },
    take: 20,
  })
  for (const match of matches) {
    if (!match.productId || claimedProductIds.has(match.productId)) continue
    const sameRetailer = await prisma.listing.findFirst({
      where: {
        id: { not: excludeListingId },
        productId: match.productId,
        retailerId,
      },
      select: { id: true },
    })
    if (!sameRetailer) return match.productId
  }
  return null
}

async function refreshPreviousProduct(
  previousProductId: string | null,
  nextProductId: string,
): Promise<void> {
  if (!previousProductId || previousProductId === nextProductId) return
  const remaining = await prisma.listing.count({ where: { productId: previousProductId } })
  if (remaining === 0) {
    await prisma.product.delete({ where: { id: previousProductId } }).catch(() => {})
  } else {
    await updateProductAggregates(previousProductId)
  }
}

async function moveListing(
  listingId: string,
  nextProductId: string,
  previousProductId: string | null,
): Promise<void> {
  await prisma.listing.update({ where: { id: listingId }, data: { productId: nextProductId } })
  await updateProductAggregates(nextProductId)
  await refreshPreviousProduct(previousProductId, nextProductId)
}

async function clusterListingAgainstCandidates(
  listingId: string,
  embedding: Float32Array,
  candidates: ProductWithListings[],
  claimedProductIds: Set<string>,
): Promise<{ productId: string; created: boolean; similarity: number; reason: string }> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      url: true,
      imageUrl: true,
      priceMinor: true,
      imageHash: true,
      productId: true,
      retailerId: true,
    },
  })
  if (!listing) throw new Error(`listing not found: ${listingId}`)

  // --- Pass 1: ASIN exact match (cheap and authoritative when present)
  const asin = extractASIN(listing.url)
  if (asin) {
    const productId = await findProductByASIN(
      asin,
      listingId,
      listing.retailerId,
      claimedProductIds,
    )
    if (productId) {
      await moveListing(listingId, productId, listing.productId)
      claimedProductIds.add(productId)
      return { productId, created: false, similarity: 1, reason: `asin:${asin}` }
    }
  }

  // --- Pass 1.5: shared product imagery (ADR-009). Hashes are computed by
  // the background enrichment queue, so this mostly fires on re-clustering;
  // fresh listings get the same signal via the late hash-merge in enrich.ts.
  if (listing.imageHash) {
    const hashed = await prisma.listing.findMany({
      where: { imageHash: { not: null }, productId: { not: null }, id: { not: listingId } },
      select: {
        imageHash: true,
        productId: true,
        priceMinor: true,
        retailerId: true,
      },
    })
    for (const hashMatch of hashed) {
      if (
        !hashMatch.productId ||
        claimedProductIds.has(hashMatch.productId) ||
        hashMatch.retailerId === listing.retailerId ||
        !hashesMatch(listing.imageHash, hashMatch.imageHash!) ||
        !priceFits(listing.priceMinor, [hashMatch.priceMinor])
      ) {
        continue
      }
      const sameRetailer = await prisma.listing.findFirst({
        where: {
          id: { not: listingId },
          productId: hashMatch.productId,
          retailerId: listing.retailerId,
        },
        select: { id: true },
      })
      if (sameRetailer) continue
      await moveListing(listingId, hashMatch.productId, listing.productId)
      claimedProductIds.add(hashMatch.productId)
      return { productId: hashMatch.productId, created: false, similarity: 1, reason: 'image-hash' }
    }
  }

  // --- Pass 2: cosine similarity over normalized-title embeddings + price sanity
  // Exclude the listing being re-clustered. Otherwise its own freshly-written
  // embedding is a perfect 1.0 match and a changed product can never leave its
  // old cluster.
  let best: { product: ProductWithListings; similarity: number } | null = null
  for (const p of candidates) {
    if (p.listings.length === 0) continue
    if (claimedProductIds.has(p.id)) continue
    // A Product is a cross-store identity, not a bin for similar variants
    // from one retailer. Exact identifiers were already handled above.
    if (p.listings.some((candidate) => candidate.retailerId === listing.retailerId)) {
      continue
    }
    if (!identityCompatible(listing.title, p.canonicalTitle)) continue
    if (!priceFits(listing.priceMinor, p.listings.map((candidate) => candidate.priceMinor))) {
      continue
    }
    const embeds = p.listings
      .map((l) => (l.textEmbedding ? bytesToFloat(l.textEmbedding) : null))
      .filter((v): v is Float32Array => v !== null && v.length === EMBEDDING_DIM)
    if (embeds.length === 0) continue
    const c = centroidOf(embeds)
    const sim = dotProduct(embedding, c)
    if (!best || sim > best.similarity) best = { product: p, similarity: sim }
  }

  // In the gray band around the threshold, cosine alone is unreliable — ask
  // the LLM judge (titles + images) for a verdict. Above the band, cosine is
  // trusted outright; when the judge is unavailable the plain threshold rule
  // decides, so search works identically with the LLM down.
  let attach = false
  let matchReason = ''
  if (best && best.similarity >= JUDGE_BAND_LOW) {
    if (best.similarity >= JUDGE_BAND_HIGH) {
      attach = true
      matchReason = 'cosine'
    } else {
      const verdict = await judgeSameProduct(
        { title: listing.title, priceMinor: listing.priceMinor, imageUrl: listing.imageUrl },
        {
          title: best.product.canonicalTitle,
          priceMinor: median(best.product.listings.map((l) => l.priceMinor).filter((p) => p > 0)),
          imageUrl: best.product.canonicalImage,
        },
      )
      if (verdict !== null) {
        attach = verdict
        matchReason = verdict ? 'judge-yes' : 'judge-no'
      } else {
        attach = best.similarity >= SIMILARITY_THRESHOLD
        matchReason = 'cosine'
      }
    }
  }

  if (best && attach) {
    const prices = best.product.listings.map((l) => l.priceMinor)
    if (priceFits(listing.priceMinor, prices)) {
      await moveListing(listingId, best.product.id, listing.productId)
      claimedProductIds.add(best.product.id)
      return {
        productId: best.product.id,
        created: false,
        similarity: best.similarity,
        reason: `${matchReason}+price-ok`,
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
  await moveListing(listingId, product.id, listing.productId)
  claimedProductIds.add(product.id)
  return {
    productId: product.id,
    created: true,
    similarity: best?.similarity ?? 0,
    reason:
      best && attach ? 'price-rejected' : matchReason === 'judge-no' ? 'judge-no' : 'no-match',
  }
}

/** Attach a listing to its best-matching existing Product, or create a new one. */
export async function clusterListing(
  listingId: string,
  embedding: Float32Array,
): Promise<{ productId: string; created: boolean; similarity: number; reason: string }> {
  return clusterListingAgainstCandidates(
    listingId,
    embedding,
    await loadCandidateProducts(listingId),
    new Set(),
  )
}

/**
 * Cluster one retailer batch against a single catalogue snapshot. The old
 * path reloaded every Product and all embeddings once per listing, which made
 * a 100-item catalogue refresh quadratic in database work and could stall the
 * next search. One claimed product per batch also preserves the invariant that
 * a canonical Product has at most one offer from a retailer.
 */
export async function clusterListingBatch(
  entries: ReadonlyArray<{ listingId: string; embedding: Float32Array }>,
): Promise<number> {
  if (entries.length === 0) return 0
  const candidates = await loadCandidateProducts(entries.map((entry) => entry.listingId))
  const claimedProductIds = new Set<string>()
  let clustered = 0
  for (const entry of entries) {
    try {
      await clusterListingAgainstCandidates(
        entry.listingId,
        entry.embedding,
        candidates,
        claimedProductIds,
      )
      clustered += 1
    } catch (error) {
      console.error(`[cluster] listing=${entry.listingId}:`, error)
    }
    // Yield between entity writes so SQLite maintenance cannot monopolize the
    // Node event loop while a later search is trying to render.
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return clustered
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
