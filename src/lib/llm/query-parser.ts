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
  maxPriceMinor: number?  // cents; "under $80" -> 8000
  minPriceMinor: number?  // cents
  features: string[]?  // e.g. ["wireless", "anc"]

Rules:
- refinedQuery is always required and must read like a clean product name.
- Strip phrases like "under $X", "below $X", "over $X", "with X", "for X".
- Strip retailer names (amazon, ebay, etc.) — those are handled elsewhere.
- For brand: ONLY include if the user said a real brand name. Don't guess.
- features: short lowercase tokens describing demanded attributes.
- Do not invent any field.

Examples:
  "wireless earbuds under $80" -> {"refinedQuery":"wireless earbuds","category":"earbuds","maxPriceMinor":8000,"features":["wireless"]}
  "sony noise cancelling headphones" -> {"refinedQuery":"sony noise cancelling headphones","category":"headphones","brand":"sony","features":["noise-cancelling"]}
  "running shoes" -> {"refinedQuery":"running shoes","category":"shoes","features":["running"]}
  "fitbit air" -> {"refinedQuery":"fitbit air","brand":"fitbit"}
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
    console.error('[query-parser]', err instanceof Error ? err.message : err)
    parsed = { refinedQuery: trimmed }
  }

  memo.set(key, { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS })
  return parsed
})
