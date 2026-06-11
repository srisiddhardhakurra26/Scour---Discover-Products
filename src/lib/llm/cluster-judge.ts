import { fetchInlineImage, generateJson, generateJsonVision, type InlineImage } from './client'

// Cosine similarity alone is unreliable in a band around the clustering
// threshold — same-title different-colorway listings score high, different
// phrasings of one product score low. For matches inside that band, ask an
// LLM (with the product images when they're fetchable) for a same-product
// verdict. Cached, time-boxed, and advisory: when the judge is unavailable
// the deterministic threshold rule decides, exactly as before.

export const JUDGE_BAND_LOW = 0.78
export const JUDGE_BAND_HIGH = 0.86

export type JudgeCandidate = {
  title: string
  priceMinor: number
  imageUrl?: string | null
}

const SYSTEM = `You decide whether two e-commerce listings refer to the same product.

"Same product" = the same model/item a buyer would consider interchangeable, even from different sellers, in different conditions (new/used/refurb), or in a different color/size variant of the same model.
NOT the same product: accessories or cases for it, a different model or generation, a bundle vs the bare item, a counterfeit-looking mismatch.

If product images are attached, the first image belongs to listing A and the second to listing B; use them to catch differences titles hide.

Return ONLY: {"same": true} or {"same": false}`

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const memo = new Map<string, { value: boolean; expiresAt: number }>()

function pairKey(a: string, b: string): string {
  const na = a.trim().toLowerCase().replace(/\s+/g, ' ')
  const nb = b.trim().toLowerCase().replace(/\s+/g, ' ')
  return na < nb ? `${na}||${nb}` : `${nb}||${na}`
}

function formatCandidate(label: string, c: JudgeCandidate): string {
  const price = c.priceMinor > 0 ? `$${(c.priceMinor / 100).toFixed(2)}` : 'unknown price'
  return `Listing ${label}: ${JSON.stringify(c.title)} (${price})`
}

function parseVerdict(json: string): boolean | null {
  try {
    const parsed = JSON.parse(json) as { same?: unknown }
    return typeof parsed.same === 'boolean' ? parsed.same : null
  } catch {
    return null
  }
}

/**
 * Same-product verdict for two listings: true/false from the LLM, or null
 * when no provider is reachable in budget (caller falls back to thresholds).
 */
export async function judgeSameProduct(
  a: JudgeCandidate,
  b: JudgeCandidate,
): Promise<boolean | null> {
  const key = pairKey(a.title, b.title)
  const hit = memo.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value

  const user = `${formatCandidate('A', a)}\n${formatCandidate('B', b)}\nSame product?`

  // Vision first when both images are quickly fetchable — pixels catch
  // colorway/model differences that titles hide. Any miss → text-only.
  let verdict: boolean | null = null
  if (a.imageUrl && b.imageUrl && process.env.GEMINI_API_KEY) {
    const [imgA, imgB] = await Promise.all([
      fetchInlineImage(a.imageUrl),
      fetchInlineImage(b.imageUrl),
    ])
    if (imgA && imgB) {
      const images: InlineImage[] = [imgA, imgB]
      try {
        verdict = parseVerdict(
          await generateJsonVision(
            { system: SYSTEM, user, images, maxTokens: 50 },
            AbortSignal.timeout(3500),
          ),
        )
      } catch (err) {
        console.warn('[cluster-judge] vision:', err instanceof Error ? err.message : err)
      }
    }
  }

  if (verdict === null) {
    try {
      verdict = parseVerdict(
        await generateJson(
          { system: SYSTEM, user, tier: 'fast', maxTokens: 50 },
          AbortSignal.timeout(3000),
        ),
      )
    } catch (err) {
      console.warn('[cluster-judge]', err instanceof Error ? err.message : err)
    }
  }

  if (verdict !== null) {
    memo.set(key, { value: verdict, expiresAt: Date.now() + CACHE_TTL_MS })
  }
  return verdict
}
