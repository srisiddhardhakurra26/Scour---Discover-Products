import type { Adapter, NormalizedListing } from './types'

type RedditChild = {
  data: {
    id?: string
    title?: string
    permalink?: string
    url?: string
    url_overridden_by_dest?: string
    thumbnail?: string
    selftext?: string
    author?: string
    score?: number
    num_comments?: number
  }
}

type RedditResponse = {
  data?: {
    children?: RedditChild[]
  }
}

function extractPriceMinor(text: string): number {
  const m = text.match(/\$\s?([\d,]+(?:\.\d+)?)/)
  if (!m) return 0
  const n = parseFloat(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function createRedditAdapter(id: string, label: string, subreddit: string): Adapter {
  // identifier is stored as "r/buildapcsales" or "buildapcsales" — handle both
  const sr = subreddit.replace(/^r\//, '').replace(/^\//, '')
  return {
    id,
    label,
    type: 'reddit',
    async search(query, signal): Promise<NormalizedListing[]> {
      const url = new URL(`https://www.reddit.com/r/${sr}/search.json`)
      url.searchParams.set('q', query)
      url.searchParams.set('restrict_sr', '1')
      url.searchParams.set('sort', 'relevance')
      url.searchParams.set('limit', '15')

      const res = await fetch(url, {
        signal,
        headers: {
          accept: 'application/json',
          // Reddit requires a descriptive UA or returns 429
          'user-agent': 'ScourBot/0.1 (cross-store product aggregator)',
        },
      })
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)

      const data = (await res.json()) as RedditResponse
      const children = data.data?.children ?? []
      return children.slice(0, 15).map((c, i) => {
        const p = c.data
        const title = p.title ?? 'Untitled'
        const isExternalLink = p.url_overridden_by_dest && p.url_overridden_by_dest !== p.url
        const link =
          p.url_overridden_by_dest ??
          (p.permalink ? `https://www.reddit.com${p.permalink}` : (p.url ?? 'https://reddit.com'))
        const thumb =
          p.thumbnail && /^https?:\/\//.test(p.thumbnail) ? p.thumbnail : undefined

        return {
          externalId: p.id ?? p.permalink ?? `${sr}-${i}`,
          title,
          url: link,
          imageUrl: thumb,
          priceMinor: extractPriceMinor(title) || extractPriceMinor(p.selftext ?? ''),
          currency: 'USD',
          sellerName: p.author ? `u/${p.author}` : undefined,
          raw: { score: p.score, num_comments: p.num_comments, isExternalLink },
        }
      })
    },
  }
}
