import { generateJson } from './client'
import type { ParsedQuery } from './query-parser'

// One candidate to be judged. `id` is the caller's stable key (we map scores
// back to it); the LLM only ever sees a positional index, to keep tokens tiny
// and avoid leaking long internal keys.
export type RerankCandidate = {
  id: string
  title: string
  brand?: string | null
  priceMinor?: number
  currency?: string
}

export type RerankScores = Map<string, number>

const SYSTEM = `You are a product-search relevance judge for a shopping aggregator.

Given a shopper's intent and a numbered list of candidate products, score how well each candidate matches what the shopper actually wants, from 0.0 (irrelevant) to 1.0 (exactly right).

Judge by PRODUCT TYPE and ATTRIBUTES using real-world knowledge — NOT surface word overlap:
- A Chelsea boot, work boot, or Blundstone IS a kind of "shoes"/"footwear" → score high for a "shoes" query.
- A sneaker, running shoe, or trainer is NOT a "leather boot" → score low for a "leather boots" query.
- Honor demanded attributes: material ("leather"), features, gender/use when stated. Missing a hard attribute the shopper asked for → low, even if the broad category is right.
- Care kits, laces, socks, cleaners, beanies and other accessories are NOT the product unless the shopper asked for them → low.

Return ONLY JSON of the form {"scores": {"<id>": <number 0..1>, ...}} with an entry for EVERY id you were given. No commentary.`

function buildUser(
  query: string,
  parsed: ParsedQuery,
  items: Array<{ id: string; title: string; brand?: string; price?: string }>,
): string {
  const intent = {
    query,
    refinedQuery: parsed.refinedQuery,
    category: parsed.category,
    brand: parsed.brand,
    features: parsed.features,
    maxPriceMinor: parsed.maxPriceMinor,
    minPriceMinor: parsed.minPriceMinor,
  }
  return `Shopper intent:\n${JSON.stringify(intent)}\n\nCandidates:\n${JSON.stringify(items)}`
}

function validate(raw: unknown, idxCount: number): Map<string, number> | null {
  if (!raw || typeof raw !== 'object') return null
  const scoresRaw = (raw as Record<string, unknown>).scores
  if (!scoresRaw || typeof scoresRaw !== 'object') return null
  const out = new Map<string, number>()
  for (const [k, v] of Object.entries(scoresRaw as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
    if (Number.isFinite(n)) out.set(k, Math.max(0, Math.min(1, n)))
  }
  // Demand coverage of at least half the candidates; a sparse response means
  // the judge misbehaved — treat as failure so the caller keeps embedding order.
  if (out.size < Math.ceil(idxCount / 2)) return null
  return out
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30m
type CacheEntry = { value: RerankScores; expiresAt: number }
const memo = new Map<string, CacheEntry>()

function cacheKey(query: string, candidates: RerankCandidate[]): string {
  const ids = candidates.map((c) => c.id).sort().join(',')
  return `${query.trim().toLowerCase()}::${ids}`
}

/**
 * Precision pass: ask an LLM to score how well each candidate matches the
 * shopper's true intent (product type + attributes), independent of word
 * overlap. This is the sharp half of a retrieve→rerank pipeline — embeddings
 * cast the wide net, this judges relevance with world knowledge.
 *
 * Returns a map of candidate id → score (0..1), or null on any failure
 * (timeout, parse error, sparse response). Callers MUST treat null as "keep
 * embedding order" so search never depends on the LLM. Cached per
 * query + candidate-set for 30 minutes.
 */
export async function rerankCandidates(
  query: string,
  parsed: ParsedQuery,
  candidates: RerankCandidate[],
): Promise<RerankScores | null> {
  if (candidates.length === 0) return null

  const key = cacheKey(query, candidates)
  const hit = memo.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value

  // Positional ids keep the prompt small and stable.
  const items = candidates.map((c, i) => ({
    id: String(i),
    title: c.title,
    ...(c.brand ? { brand: c.brand } : {}),
    ...(c.priceMinor && c.priceMinor > 0 ? { price: (c.priceMinor / 100).toFixed(2) } : {}),
  }))

  let idxScores: Map<string, number> | null
  try {
    const json = await generateJson(
      {
        system: SYSTEM,
        user: buildUser(query, parsed, items),
        tier: 'reasoning',
        maxTokens: 1200,
      },
      AbortSignal.timeout(8000),
    )
    idxScores = validate(JSON.parse(json), items.length)
  } catch (err) {
    console.error('[rerank]', err instanceof Error ? err.message : err)
    return null
  }
  if (!idxScores) return null

  // Map positional ids back to the caller's real ids.
  const out: RerankScores = new Map()
  for (const [idx, score] of idxScores) {
    const c = candidates[Number(idx)]
    if (c) out.set(c.id, score)
  }

  memo.set(key, { value: out, expiresAt: Date.now() + CACHE_TTL_MS })
  return out
}
