import Parser from 'rss-parser'
import type { Adapter, NormalizedListing } from './types'
import { readTextLimited } from '@/lib/http'

type SlickdealsItem = {
  contentEncoded?: string
  mediaThumbnail?: string | { $?: { url?: string } }
}

const parser = new Parser<unknown, SlickdealsItem>({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
    ],
  },
})

function extractPriceMinor(text: string): number {
  const m = text.match(/\$\s?([\d,]+(?:\.\d+)?)/)
  if (!m) return 0
  const n = parseFloat(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function extractImageFromHtml(html: string | undefined): string | undefined {
  if (!html) return undefined
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return m?.[1]
}

type ThumbnailField = string | { $?: { url?: string } } | undefined

function extractMediaThumbnail(field: ThumbnailField): string | undefined {
  if (!field) return undefined
  if (typeof field === 'string') return field
  return field.$?.url
}

export function createSlickdealsAdapter(id: string, label: string): Adapter {
  return {
    id,
    label,
    type: 'rss',
    async search(query, signal): Promise<NormalizedListing[]> {
      const url = new URL('https://slickdeals.net/newsearch.php')
      url.searchParams.set('q', query)
      url.searchParams.set('searcharea', 'deals')
      url.searchParams.set('searchin', 'first')
      url.searchParams.set('rss', '1')

      const res = await fetch(url, {
        signal,
        headers: {
          accept: 'application/rss+xml, application/xml, text/xml',
          'user-agent': 'ScourBot/0.1 (+https://github.com/scour)',
        },
      })
      if (!res.ok) throw new Error(`Slickdeals: HTTP ${res.status}`)

      const xml = await readTextLimited(res, 2_000_000)
      const feed = await parser.parseString(xml)

      return (feed.items ?? []).slice(0, 15).map((item, i) => {
        const title = item.title ?? 'Untitled deal'
        const priceMinor = extractPriceMinor(title) || extractPriceMinor(item.contentSnippet ?? '')
        const imageUrl =
          extractMediaThumbnail(item.mediaThumbnail as ThumbnailField) ??
          extractImageFromHtml(item.contentEncoded) ??
          extractImageFromHtml(item.content)

        return {
          externalId: item.guid ?? item.link ?? `slickdeals-${i}`,
          title,
          url: item.link ?? 'https://slickdeals.net',
          imageUrl,
          priceMinor,
          currency: 'USD',
          sellerName: item.creator ?? 'Slickdeals user',
        }
      })
    },
  }
}
