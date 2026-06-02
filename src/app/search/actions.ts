'use server'

import { getAdapters } from '@/lib/adapters/registry'
import {
  summarizeDiscussions,
  type Discussion,
  type ProductIntel,
} from '@/lib/llm/product-intel'

// Reddit communities (type 'reddit') and Slickdeals (type 'rss') are the
// discussion sources. The same adapters that surface them as listings are
// reused here to gather chatter, then an LLM distills sentiment.
const DISCUSSION_TYPES = new Set(['reddit', 'rss'])

export type IntelResponse = {
  intel: ProductIntel | null
  sources: number
  error?: string
}

// Trim a canonical product title into a tight forum query: drop trailing
// parentheticals / clauses and cap length so we search for the product, not a
// paragraph.
function toDiscussionQuery(title: string): string {
  return title.replace(/[,(].*$/, '').trim().slice(0, 80)
}

export async function getProductIntel(productTitle: string): Promise<IntelResponse> {
  const query = toDiscussionQuery(productTitle)
  if (!query) return { intel: null, sources: 0, error: 'Missing product title.' }

  const adapters = (await getAdapters()).filter((a) => DISCUSSION_TYPES.has(a.type))
  if (adapters.length === 0) {
    return {
      intel: null,
      sources: 0,
      error: 'No Reddit or Slickdeals sources enabled — turn one on under Sources.',
    }
  }

  const discussions: Discussion[] = []
  const results = await Promise.allSettled(
    adapters.map(async (a) => ({
      label: a.label,
      listings: await a.search(query, AbortSignal.timeout(6000)),
    })),
  )
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const l of r.value.listings.slice(0, 10)) {
      const raw = (l.raw ?? {}) as { score?: number; num_comments?: number }
      discussions.push({
        source: r.value.label,
        title: l.title,
        score: typeof raw.score === 'number' ? raw.score : undefined,
        comments: typeof raw.num_comments === 'number' ? raw.num_comments : undefined,
      })
    }
  }

  const intel = await summarizeDiscussions(query, discussions)
  return { intel, sources: discussions.length }
}
