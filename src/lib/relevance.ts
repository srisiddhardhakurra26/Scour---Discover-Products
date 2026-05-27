import type { NormalizedListing } from './adapters/types'
import { dotProduct, embedQueryCached, embedTexts } from './embeddings'

// Threshold for cosine similarity between query embedding and listing-title embedding.
// Tuned empirically for all-MiniLM-L6-v2:
//   ~0.5+: clearly related ("earbuds" → "Apple AirPods Pro Wireless Earbuds")
//   ~0.3:  same category ("shoe" → "Tree Dasher 2")
//   ~0.15: weak / off-topic
// Set just above weak so we drop the cocoa-shoe class of false positives.
export const RELEVANCE_THRESHOLD = 0.22

export type RankedListing = {
  listing: NormalizedListing
  embedding: Float32Array
  score: number
}

export type RankResult = {
  kept: RankedListing[]
  dropped: number
}

export async function rankByRelevance(
  query: string,
  listings: NormalizedListing[],
): Promise<RankResult> {
  if (listings.length === 0) return { kept: [], dropped: 0 }
  if (!query.trim()) {
    // No query → don't rank, just embed for persistence.
    const vectors = await embedTexts(listings.map((l) => l.title))
    return {
      kept: listings.map((listing, i) => ({ listing, embedding: vectors[i], score: 1 })),
      dropped: 0,
    }
  }

  const [queryVec, titleVecs] = await Promise.all([
    embedQueryCached(query),
    embedTexts(listings.map((l) => l.title)),
  ])

  const scored: RankedListing[] = listings.map((listing, i) => ({
    listing,
    embedding: titleVecs[i],
    score: dotProduct(queryVec, titleVecs[i]),
  }))

  const kept = scored
    .filter((s) => s.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  return { kept, dropped: scored.length - kept.length }
}
