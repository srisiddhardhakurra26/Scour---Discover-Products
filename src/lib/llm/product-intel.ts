import { cache } from 'react'
import { generateJson } from './client'

export type Verdict = 'positive' | 'mixed' | 'negative' | 'unknown'

export type ProductIntel = {
  verdict: Verdict
  summary: string
  pros: string[]
  cons: string[]
  dealTip?: string
}

// A single piece of community chatter (a Reddit post or Slickdeals deal) about
// the product, distilled to what the summarizer needs.
export type Discussion = {
  source: string
  title: string
  score?: number
  comments?: number
}

const SYSTEM = `You analyze community chatter about a product, gathered from deal forums (Slickdeals) and Reddit threads.

Return ONLY a JSON object:
  verdict: "positive" | "mixed" | "negative" | "unknown"
  summary: string   // <= 240 chars, plain sentence(s), no markdown
  pros: string[]    // <= 4 short phrases (<= 8 words each)
  cons: string[]    // <= 4 short phrases (<= 8 words each)
  dealTip: string?  // one line ONLY if a snippet mentions a notable price/discount/where-to-buy

Rules:
- Base everything ONLY on the provided snippets. Never invent specs, prices, or reviews.
- Higher upvote/comment counts mean a snippet carries more weight.
- If the snippets are sparse, off-topic, or don't actually discuss this product, return verdict "unknown", a one-line summary saying there isn't enough community signal, and empty pros/cons.
- Keep pros/cons concrete (e.g. "great battery life", "stitching wears fast"), not generic.
- No commentary outside the JSON.`

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  'positive',
  'mixed',
  'negative',
  'unknown',
])

function cleanList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max)
}

function validate(raw: unknown): ProductIntel {
  if (!raw || typeof raw !== 'object') {
    return { verdict: 'unknown', summary: 'No usable community signal.', pros: [], cons: [] }
  }
  const obj = raw as Record<string, unknown>
  const verdict =
    typeof obj.verdict === 'string' && VALID_VERDICTS.has(obj.verdict)
      ? (obj.verdict as Verdict)
      : 'unknown'
  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim().slice(0, 280)
      : 'No summary available.'
  const intel: ProductIntel = {
    verdict,
    summary,
    pros: cleanList(obj.pros, 4),
    cons: cleanList(obj.cons, 4),
  }
  if (typeof obj.dealTip === 'string' && obj.dealTip.trim()) {
    intel.dealTip = obj.dealTip.trim().slice(0, 200)
  }
  return intel
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30m — chatter changes slowly
type CacheEntry = { value: ProductIntel; expiresAt: number }
const memo = new Map<string, CacheEntry>()

function normalizeKey(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Summarize community sentiment for a product from gathered discussions.
 * Cached per product title for 30 minutes. Returns an "unknown" verdict (never
 * throws) when there's nothing to work with or the LLM is unavailable — this is
 * an on-demand enrichment, never on the search critical path.
 */
export const summarizeDiscussions = cache(
  async (productTitle: string, discussions: Discussion[]): Promise<ProductIntel> => {
    if (discussions.length === 0) {
      return {
        verdict: 'unknown',
        summary: 'No Reddit or Slickdeals discussion found for this product.',
        pros: [],
        cons: [],
      }
    }

    const key = normalizeKey(productTitle)
    const hit = memo.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.value

    const snippets = discussions
      .slice(0, 24)
      .map((d) => {
        const meta = [
          d.score != null ? `${d.score} upvotes` : null,
          d.comments != null ? `${d.comments} comments` : null,
        ]
          .filter(Boolean)
          .join(', ')
        return `- [${d.source}${meta ? `, ${meta}` : ''}] ${d.title}`
      })
      .join('\n')

    let intel: ProductIntel
    try {
      const json = await generateJson(
        {
          system: SYSTEM,
          user: `Product: ${productTitle}\n\nCommunity snippets:\n${snippets}`,
          tier: 'reasoning',
          maxTokens: 600,
        },
        AbortSignal.timeout(15_000),
      )
      intel = validate(JSON.parse(json))
    } catch (err) {
      console.error('[product-intel]', err instanceof Error ? err.message : err)
      return {
        verdict: 'unknown',
        summary: 'Community intel is unavailable right now.',
        pros: [],
        cons: [],
      }
    }

    memo.set(key, { value: intel, expiresAt: Date.now() + CACHE_TTL_MS })
    return intel
  },
)
