import { generateJson } from './client'

// When a store returns nothing for the user's query, one reformulation in
// that store's own vocabulary often rescues it — "leather shoes" finds
// nothing at Blundstone, "chelsea boot" finds their whole catalog. One LLM
// call per (store, query), cached an hour, time-boxed, and optional: a
// failure simply means no retry, never a failed search.

const CACHE_TTL_MS = 60 * 60 * 1000
const memo = new Map<string, { value: string | null; expiresAt: number }>()

const SYSTEM = `You reformulate e-commerce search queries for one specific store whose search returned nothing.

Return ONLY a JSON object: {"altQuery": string | null}

Rules:
- altQuery must be a SHORT product query (2-4 words) in the vocabulary that store's own catalog likely uses, for the SAME product the user wants.
- Never substitute a different product, an accessory, or a related item. If the user wants a gaming laptop and the store sells coffee, there is no valid reformulation — return null. A laptop sleeve is NOT a laptop.
- If the store plausibly doesn't sell this product category, return {"altQuery": null}. Most stores are specialized; null is the common correct answer.
- Do not return the original query or a trivial rewording of it.

Examples:
- "leather shoes" at Blundstone (boot brand) -> {"altQuery": "chelsea boot"}
- "running shoes" at Allbirds -> {"altQuery": "tree runner"}
- "gaming laptop" at Death Wish Coffee -> {"altQuery": null}
- "espresso beans" at Nike -> {"altQuery": null}`

function cacheKey(query: string, storeLabel: string): string {
  return `${storeLabel.toLowerCase()}::${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

/**
 * Suggest one store-specific alternative query, or null when there is no
 * sensible alternative (or the LLM is unavailable). Cached per store+query.
 */
export async function reformulateForStore(
  query: string,
  storeLabel: string,
  storeType: string,
): Promise<string | null> {
  const key = cacheKey(query, storeLabel)
  const hit = memo.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value

  let alt: string | null = null
  try {
    const json = await generateJson(
      {
        system: SYSTEM,
        user:
          `Store: ${JSON.stringify(storeLabel)} (a ${storeType} source)\n` +
          `Query that returned nothing there: ${JSON.stringify(query)}`,
        tier: 'reasoning',
        maxTokens: 80,
      },
      AbortSignal.timeout(2500),
    )
    const parsed = JSON.parse(json) as { altQuery?: unknown }
    if (typeof parsed.altQuery === 'string' && parsed.altQuery.trim()) {
      const candidate = parsed.altQuery.trim().toLowerCase()
      if (candidate !== query.trim().toLowerCase()) alt = candidate
    }
    // Cache nulls too — "store doesn't sell this" is a stable answer.
    memo.set(key, { value: alt, expiresAt: Date.now() + CACHE_TTL_MS })
  } catch (err) {
    console.warn('[requery]', err instanceof Error ? err.message : err)
    // Don't cache LLM failures; the next search can retry.
  }
  return alt
}
