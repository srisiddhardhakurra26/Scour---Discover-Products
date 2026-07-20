import type { Adapter, NormalizedListing } from './types'
import { readJsonLimited } from '@/lib/http'

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

const REDDIT_UA = 'ScourBot/0.1 (cross-store product aggregator)'

// Reddit blocks unauthenticated JSON requests (403) from scripts and
// datacenter IPs. With a registered "script" app (REDDIT_CLIENT_ID /
// REDDIT_CLIENT_SECRET in the environment) we use the official OAuth API
// instead, which allows ~100 requests/min on the free tier. Without
// credentials the adapter falls back to the unauthenticated endpoint —
// which may well 403, but degrades exactly as before.
let cachedToken: { token: string; expiresAt: number } | null = null

async function getOAuthToken(signal?: AbortSignal): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID
  const secret = process.env.REDDIT_CLIENT_SECRET
  if (!id || !secret) return null
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    signal,
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': REDDIT_UA,
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`reddit oauth: HTTP ${res.status}`)
  const data = await readJsonLimited<{ access_token?: string; expires_in?: number }>(res, 100_000)
  if (!data.access_token) throw new Error('reddit oauth: no token in response')
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return cachedToken.token
}

export function createRedditAdapter(id: string, label: string, subreddit: string): Adapter {
  // identifier is stored as "r/buildapcsales" or "buildapcsales" — handle both
  const sr = subreddit.replace(/^r\//, '').replace(/^\//, '')
  return {
    id,
    label,
    type: 'reddit',
    async search(query, signal): Promise<NormalizedListing[]> {
      let token: string | null = null
      try {
        token = await getOAuthToken(signal)
      } catch (err) {
        console.warn(`[reddit] oauth failed, using unauthenticated endpoint:`, err)
      }

      const base = token
        ? `https://oauth.reddit.com/r/${sr}/search`
        : `https://www.reddit.com/r/${sr}/search.json`
      const url = new URL(base)
      url.searchParams.set('q', query)
      url.searchParams.set('restrict_sr', '1')
      url.searchParams.set('sort', 'relevance')
      url.searchParams.set('limit', '15')

      const res = await fetch(url, {
        signal,
        headers: {
          accept: 'application/json',
          // Reddit requires a descriptive UA or returns 429
          'user-agent': REDDIT_UA,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)

      const data = await readJsonLimited<RedditResponse>(res, 2_000_000)
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
