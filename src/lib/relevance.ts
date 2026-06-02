import type { NormalizedListing } from './adapters/types'
import { dotProduct, embedQueryCached, embedTexts } from './embeddings'
import type { ParsedQuery } from './llm/query-parser'
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

export type RecallMode = 'strict' | 'high'

// Discovery feeds (Reddit, Slickdeals RSS) return loosely-related items, so the
// strict embedding gate below earns its keep. Direct product searches (Shopify,
// Nike/generic-html, Amazon, eBay, …) already matched the query on the
// retailer's side — re-running a strict semantic filter there discards good
// results: "Air Jordan 1" scores ~0.24 against the word "shoes" yet is exactly
// what the user asked Nike for. For those we rank by score but only drop items
// that look clearly off-topic (e.g. a catalog dump from a store that ignores
// the query).
const HIGH_RECALL_FLOOR = 0.15
const FEED_TYPES = new Set(['reddit', 'rss'])

export function recallModeForType(type: string): RecallMode {
  return FEED_TYPES.has(type) ? 'strict' : 'high'
}

function withinPriceWindow(priceMinor: number, parsed?: ParsedQuery): boolean {
  if (!parsed) return true
  if (priceMinor <= 0) return true // no price extracted; don't drop
  if (parsed.maxPriceMinor !== undefined && priceMinor > parsed.maxPriceMinor) return false
  if (parsed.minPriceMinor !== undefined && priceMinor < parsed.minPriceMinor) return false
  return true
}

export async function rankByRelevance(
  query: string,
  listings: NormalizedListing[],
  parsed?: ParsedQuery,
  mode: RecallMode = 'strict',
): Promise<RankResult> {
  if (listings.length === 0) return { kept: [], dropped: 0 }
  // Use the LLM-refined query for semantic + token matching when available
  // — strips price phrases ("under $80") and other filter noise that would
  // otherwise pollute the embedding.
  const matchQuery = parsed?.refinedQuery?.trim() || query
  if (!matchQuery.trim()) {
    const vectors = await embedTexts(listings.map((l) => normalizeTitle(l.title)))
    return {
      kept: listings.map((listing, i) => ({ listing, embedding: vectors[i], score: 1 })),
      dropped: 0,
    }
  }

  const [queryVec, titleVecs] = await Promise.all([
    embedQueryCached(matchQuery),
    embedTexts(listings.map((l) => normalizeTitle(l.title))),
  ])

  const { floor, trust } = thresholdFor(matchQuery)

  const scored: RankedListing[] = listings.map((listing, i) => ({
    listing,
    embedding: titleVecs[i],
    score: dotProduct(queryVec, titleVecs[i]),
  }))

  const kept = scored
    .filter((s) => {
      if (!withinPriceWindow(s.listing.priceMinor, parsed)) return false
      if (mode === 'high') {
        // Retailer already matched the query; only drop clearly off-topic noise.
        return s.score >= HIGH_RECALL_FLOOR
      }
      if (s.score < floor) return false
      if (s.score >= trust) return true
      return hasTokenOverlap(matchQuery, s.listing.title)
    })
    .sort((a, b) => b.score - a.score)

  return { kept, dropped: scored.length - kept.length }
}
