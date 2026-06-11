import { cache } from 'react'
import { generateJson } from './client'

export type ParsedQuery = {
  /** Cleaned query suitable for embedding — strips filters like "under $80". */
  refinedQuery: string
  /** Product category if expressed, e.g. "headphones", "shoes". */
  category?: string
  /** Brand if expressed, e.g. "Sony". */
  brand?: string
  /** Price ceiling in minor units (cents). */
  maxPriceMinor?: number
  /** Price floor in minor units (cents). */
  minPriceMinor?: number
  /** Feature words the user demanded, e.g. ["wireless", "noise-cancelling"]. */
  features?: string[]
}

const SYSTEM = `You parse e-commerce search queries into structured filters.
Return ONLY a JSON object with these keys (omit any that aren't present in the query):
  refinedQuery: string  // the product name with filters/price/brand stripped
  category: string?
  brand: string?
  maxPriceMinor: number?  // price CEILING in cents
  minPriceMinor: number?  // price FLOOR in cents
  features: string[]?  // e.g. ["wireless", "anc"]

Price rules — direction matters, read carefully:
- "under / below / less than / at most / up to / cheaper than $X" is a CEILING -> maxPriceMinor (X*100).
- "above / over / more than / at least / starting at / minimum $X" is a FLOOR -> minPriceMinor (X*100).
- "between $X and $Y" -> minPriceMinor (X*100) AND maxPriceMinor (Y*100).
- NEVER emit maxPriceMinor for an "above/over" phrase. NEVER emit minPriceMinor for an "under/below" phrase.

Other rules:
- refinedQuery is always required and must read like a clean product name.
- Strip every price phrase (and "with X", "for X") from refinedQuery.
- Strip retailer names (amazon, ebay, etc.) — those are handled elsewhere.
- For brand: ONLY include if the user said a real brand name. Don't guess.
- features: short lowercase tokens describing demanded attributes.
- Do not invent any field.

Examples:
  "wireless earbuds under $80" -> {"refinedQuery":"wireless earbuds","category":"earbuds","maxPriceMinor":8000,"features":["wireless"]}
  "sunscreen above $10" -> {"refinedQuery":"sunscreen","category":"sunscreen","minPriceMinor":1000}
  "headphones over $50" -> {"refinedQuery":"headphones","category":"headphones","minPriceMinor":5000}
  "jacket between $40 and $90" -> {"refinedQuery":"jacket","category":"jacket","minPriceMinor":4000,"maxPriceMinor":9000}
  "sony noise cancelling headphones" -> {"refinedQuery":"sony noise cancelling headphones","category":"headphones","brand":"sony","features":["noise-cancelling"]}
  "running shoes" -> {"refinedQuery":"running shoes","category":"shoes","features":["running"]}
  "airpods pro" -> {"refinedQuery":"airpods pro","brand":"apple"}
`

const CACHE_TTL_MS = 60 * 60 * 1000 // 1h — queries don't change meaning
type CacheEntry = { value: ParsedQuery; expiresAt: number }
const memo = new Map<string, CacheEntry>()

function normalizeKey(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

function validate(raw: unknown, fallbackQuery: string): ParsedQuery {
  if (!raw || typeof raw !== 'object') return { refinedQuery: fallbackQuery }
  const obj = raw as Record<string, unknown>
  const refined =
    typeof obj.refinedQuery === 'string' && obj.refinedQuery.trim().length > 0
      ? obj.refinedQuery.trim()
      : fallbackQuery
  const result: ParsedQuery = { refinedQuery: refined }
  if (typeof obj.category === 'string' && obj.category.trim()) {
    result.category = obj.category.trim().toLowerCase()
  }
  if (typeof obj.brand === 'string' && obj.brand.trim()) {
    result.brand = obj.brand.trim().toLowerCase()
  }
  if (typeof obj.maxPriceMinor === 'number' && Number.isFinite(obj.maxPriceMinor)) {
    result.maxPriceMinor = Math.round(obj.maxPriceMinor)
  }
  if (typeof obj.minPriceMinor === 'number' && Number.isFinite(obj.minPriceMinor)) {
    result.minPriceMinor = Math.round(obj.minPriceMinor)
  }
  if (Array.isArray(obj.features)) {
    const feats = obj.features
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .map((f) => f.trim().toLowerCase())
    if (feats.length > 0) result.features = feats
  }
  return result
}

// Price thresholds are parsed deterministically rather than left to the LLM:
// the fast model routinely flips "above $X" and "under $X". A regex gets the
// direction right every time and works even when the LLM call fails entirely.
// Exported for tests.
export function parsePriceBounds(query: string): { minPriceMinor?: number; maxPriceMinor?: number } {
  const q = query.toLowerCase()
  const amount = String.raw`\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd|bucks?|\$)?`
  const toMinor = (s: string) => Math.round(parseFloat(s) * 100)
  const out: { minPriceMinor?: number; maxPriceMinor?: number } = {}

  const between = q.match(new RegExp(String.raw`\bbetween\s+${amount}\s+(?:and|to|-)\s+${amount}`))
  if (between) {
    const a = toMinor(between[1])
    const b = toMinor(between[2])
    out.minPriceMinor = Math.min(a, b)
    out.maxPriceMinor = Math.max(a, b)
    return out
  }

  const ceiling = q.match(
    new RegExp(String.raw`\b(?:under|below|less than|at most|up to|cheaper than|no more than)\s*${amount}`),
  )
  if (ceiling) out.maxPriceMinor = toMinor(ceiling[1])

  const floor = q.match(
    new RegExp(String.raw`\b(?:above|over|more than|at least|starting at|minimum|min)\s*${amount}`),
  )
  if (floor) out.minPriceMinor = toMinor(floor[1])

  // "max $50" / "maximum 50 dollars" — but only with an explicit currency
  // marker, so product names like "iPhone Pro Max 256GB" don't read as a
  // price ceiling.
  if (out.maxPriceMinor === undefined) {
    const maxCur =
      q.match(/\bmax(?:imum)?\s*(?:of\s*)?\$\s*(\d+(?:\.\d{1,2})?)/) ??
      q.match(/\bmax(?:imum)?\s*(?:of\s*)?(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd|bucks?)\b/)
    if (maxCur) out.maxPriceMinor = toMinor(maxCur[1])
  }

  return out
}

/**
 * Parse a search query into structured filters. Caches per query string for
 * 1 hour (process-wide) and additionally per-request via React.cache. On
 * LLM failure, returns the raw query with no filters — search still works,
 * just without the agent's help.
 */
export const parseQuery = cache(async (rawQuery: string): Promise<ParsedQuery> => {
  const trimmed = rawQuery.trim()
  if (!trimmed) return { refinedQuery: '' }

  const key = normalizeKey(trimmed)
  const hit = memo.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value

  let parsed: ParsedQuery
  let llmOk = true
  try {
    const json = await generateJson(
      {
        system: SYSTEM,
        user: `Parse this query: ${JSON.stringify(trimmed)}`,
        tier: 'fast',
        maxTokens: 300,
      },
      AbortSignal.timeout(4000),
    )
    parsed = validate(JSON.parse(json), trimmed)
  } catch (err) {
    // warn, not error: LLM failures fall back to the raw query and shouldn't
    // trip the Next dev overlay.
    console.warn('[query-parser]', err instanceof Error ? err.message : err)
    parsed = { refinedQuery: trimmed }
    llmOk = false
  }

  // Price is authoritative from the deterministic parser, overriding whatever
  // the LLM guessed (and surviving an LLM failure).
  const bounds = parsePriceBounds(trimmed)
  parsed.minPriceMinor = bounds.minPriceMinor
  parsed.maxPriceMinor = bounds.maxPriceMinor

  // Only cache successful parses: a degraded parse cached for an hour would
  // pin every repeat of this query to the fallback even after the LLM
  // recovers. (React.cache still dedupes within the request.)
  if (llmOk) memo.set(key, { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS })
  return parsed
})
