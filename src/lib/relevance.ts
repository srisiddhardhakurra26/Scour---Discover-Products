import type { NormalizedListing } from './adapters/types'
import { dotProduct, embedQueryCached, embedTexts } from './embeddings'
import { normalizeTitle } from './text'

// Threshold scales with query length. Short generic queries ("shoes") produce
// weak embeddings, so we demand a tighter match; multi-word queries can be
// looser. Above the upper band we trust the embedding; in the lower band we
// also require at least one query token to appear in the title.
//   ~0.5+: clearly related ("earbuds" → "Apple AirPods Pro Wireless Earbuds")
//   ~0.3:  same category ("shoe" → "Tree Dasher 2")
//   ~0.15: weak / off-topic
function thresholdFor(query: string): { floor: number; trust: number } {
  const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 1 && tokens[0].length <= 5) return { floor: 0.4, trust: 0.5 }
  if (tokens.length === 1) return { floor: 0.35, trust: 0.45 }
  return { floor: 0.3, trust: 0.42 }
}

// Token-overlap guard. For a single-word query, the token (or its singular
// form) must appear in the title. For a multi-word query, *every* meaningful
// (>= 3 char) token must appear — otherwise "fitbit air" matches any title
// containing "air" (e.g. "AirPods") on embedding similarity alone.
function tokenMatchesTitle(token: string, titleLower: string): boolean {
  if (titleLower.includes(token)) return true
  if (token.endsWith('s') && token.length > 3 && titleLower.includes(token.slice(0, -1))) {
    return true
  }
  return false
}

function hasTokenOverlap(query: string, title: string): boolean {
  const qTokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  if (qTokens.length === 0) return true
  const tLower = title.toLowerCase()
  if (qTokens.length === 1) return tokenMatchesTitle(qTokens[0], tLower)
  return qTokens.every((t) => tokenMatchesTitle(t, tLower))
}

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
    const vectors = await embedTexts(listings.map((l) => normalizeTitle(l.title)))
    return {
      kept: listings.map((listing, i) => ({ listing, embedding: vectors[i], score: 1 })),
      dropped: 0,
    }
  }

  const [queryVec, titleVecs] = await Promise.all([
    embedQueryCached(query),
    embedTexts(listings.map((l) => normalizeTitle(l.title))),
  ])

  const { floor, trust } = thresholdFor(query)

  const scored: RankedListing[] = listings.map((listing, i) => ({
    listing,
    embedding: titleVecs[i],
    score: dotProduct(queryVec, titleVecs[i]),
  }))

  const kept = scored
    .filter((s) => {
      if (s.score < floor) return false
      if (s.score >= trust) return true
      return hasTokenOverlap(query, s.listing.title)
    })
    .sort((a, b) => b.score - a.score)

  return { kept, dropped: scored.length - kept.length }
}
