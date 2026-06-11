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
  /** Retailer-provided type/tags/description — attribute evidence for the judge. */
  details?: string
}

export type RerankScores = Map<string, number>

/**
 * Did the judge have real attribute evidence for a candidate — more than a
 * bare type word ("Shoes")? Callers use this to decide whether a judge
 * rejection was informed (respect it) or blind (title-only; eligible for the
 * embedding fallback when the judge rejects an entire pool).
 */
export function hasAttributeEvidence(details?: string): boolean {
  return !!details && details.trim().length >= 20
}

const SYSTEM = `You are a product-search relevance judge for a shopping aggregator.

Given a shopper's intent and a numbered list of candidate products, score how well each candidate matches what the shopper actually wants, from 0.0 (irrelevant) to 1.0 (exactly right).

Judge by PRODUCT TYPE and ATTRIBUTES using real-world knowledge — NOT surface word overlap:
- A Chelsea boot, work boot, or Blundstone IS a kind of "shoes"/"footwear" → score high for a "shoes" query.
- A sneaker, running shoe, or trainer is NOT a "leather boot" → score low for a "leather boots" query.
- Demanded attributes are MANDATORY, not nice-to-haves. If the shopper specified a material ("leather", "suede"), feature, gender, or use, a candidate that does not clearly match it scores low (<= 0.3) — even when the broad product category is right. Do NOT assume an unstated attribute is satisfied: if a required material is neither stated in the title nor strongly implied by the model/product, treat the match as weak, not strong.
- Some candidates include a "details" field with the retailer's own type/tags/description. Attributes stated there COUNT as stated — e.g. a bare-SKU title whose details say "premium leather upper" DOES satisfy a "leather" demand, and details saying "suede" do NOT satisfy "leather" unless the shopper asked for suede.
- Care kits, laces, socks, cleaners, beanies and other accessories are NOT the product unless the shopper asked for them → low.

Score EVERY id you are given — never omit one. Return ONLY JSON of the form {"scores": {"<id>": <number 0..1>, ...}}. No commentary.`

function buildUser(
  query: string,
  parsed: ParsedQuery,
  items: Array<{ id: string; title: string; brand?: string; price?: string; details?: string }>,
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
  // The judge is told to score EVERY id, so demand near-complete coverage. A
  // sparse answer means it misbehaved — or silently dropped the candidates it
  // judged irrelevant, which the caller would later read as "keep". Either way
  // don't trust a half-answer: fail so the caller falls back to embedding order.
  if (out.size < Math.ceil(idxCount * 0.8)) return null
  return out
}

// Per-item cache: query + candidate id → score. The old cache keyed on the
// whole candidate set, which changed between runs (adapters time out
// variably), so it almost never hit — every search re-judged everything,
// burning the free-tier rate limit and flipping between "judged" and
// "fallback" orderings run to run. Per-item entries survive set changes:
// repeat searches only judge candidates not seen before.
const CACHE_TTL_MS = 30 * 60 * 1000 // 30m
const CACHE_MAX_ENTRIES = 5000
type CacheEntry = { score: number; expiresAt: number }
const memo = new Map<string, CacheEntry>()

function itemKey(query: string, id: string): string {
  return `${query.trim().toLowerCase()}::${id}`
}

function sweepCache(now: number) {
  if (memo.size <= CACHE_MAX_ENTRIES) return
  for (const [k, v] of memo) {
    if (v.expiresAt <= now) memo.delete(k)
  }
  if (memo.size <= CACHE_MAX_ENTRIES) return
  // Still over budget: drop oldest-inserted entries (Map preserves order).
  const excess = memo.size - CACHE_MAX_ENTRIES
  let i = 0
  for (const k of memo.keys()) {
    if (i++ >= excess) break
    memo.delete(k)
  }
}

/**
 * Precision pass: ask an LLM to score how well each candidate matches the
 * shopper's true intent (product type + attributes), independent of word
 * overlap. This is the sharp half of a retrieve→rerank pipeline — embeddings
 * cast the wide net, this judges relevance with world knowledge.
 *
 * Returns a TOTAL map of candidate id → score (0..1), or null on any failure
 * (timeout, parse error, sparse response). Callers MUST treat null as "keep
 * embedding order" so search never depends on the LLM.
 */
export async function rerankCandidates(
  query: string,
  parsed: ParsedQuery,
  candidates: RerankCandidate[],
): Promise<RerankScores | null> {
  if (candidates.length === 0) return null

  const now = Date.now()
  const out: RerankScores = new Map()
  const pending: RerankCandidate[] = []
  for (const c of candidates) {
    const hit = memo.get(itemKey(query, c.id))
    if (hit && hit.expiresAt > now) out.set(c.id, hit.score)
    else pending.push(c)
  }
  if (pending.length === 0) return out

  // Positional ids keep the prompt small and stable.
  const items = pending.map((c, i) => ({
    id: String(i),
    title: c.title,
    ...(c.brand ? { brand: c.brand } : {}),
    ...(c.priceMinor && c.priceMinor > 0 ? { price: (c.priceMinor / 100).toFixed(2) } : {}),
    ...(c.details ? { details: c.details.slice(0, 200) } : {}),
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
    // warn, not error: LLM rate-limits/timeouts are routine and handled by
    // the embedding-order fallback; console.error trips the Next dev overlay.
    console.warn('[rerank]', err instanceof Error ? err.message : err)
    idxScores = null
  }
  if (!idxScores) return null

  // Map positional ids back to the caller's real ids, keeping the map TOTAL:
  // every candidate gets a score. validate() already guaranteed the judge
  // covered >= 80% of ids, so any id still missing here is a deliberate "not
  // relevant" — default it to 0 (which callers drop) instead of leaving it
  // unscored, which callers silently KEEP. That silent-keep was letting
  // off-intent items (e.g. non-leather shoes for "leather shoes") slip through.
  pending.forEach((c, i) => {
    const s = idxScores.get(String(i)) ?? 0
    out.set(c.id, s)
    memo.set(itemKey(query, c.id), { score: s, expiresAt: now + CACHE_TTL_MS })
  })
  sweepCache(now)
  return out
}
