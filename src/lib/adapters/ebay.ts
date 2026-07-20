import type { Adapter, NormalizedListing } from './types'
import { readTextLimited } from '@/lib/http'

// Scrape-based eBay adapter. eBay refuses to serve the search page to a
// request that doesn't carry session cookies, so we visit the homepage once
// to harvest cookies, cache them, and reuse them across searches.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const COOKIE_TTL_MS = 10 * 60 * 1000 // refresh every 10 min

type CookieCache = { value: string; expiresAt: number }
let cookieCache: CookieCache | null = null

async function getCookies(signal: AbortSignal): Promise<string> {
  if (cookieCache && cookieCache.expiresAt > Date.now()) return cookieCache.value
  const res = await fetch('https://www.ebay.com/', {
    signal,
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) throw new Error(`eBay homepage: HTTP ${res.status}`)
  const setCookies = res.headers.getSetCookie?.() ?? []
  const value = setCookies.map((c) => c.split(';')[0]).join('; ')
  cookieCache = { value, expiresAt: Date.now() + COOKIE_TTL_MS }
  return value
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

type CardStart = { listingId: string; start: number }

function findCardStarts(html: string): CardStart[] {
  const re = /<li class="s-card[^"]*"[^>]*\bdata-listingid=(?:"|)([0-9]+)/g
  const starts: CardStart[] = []
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    starts.push({ listingId: m[1], start: m.index })
  }
  return starts
}

function parseCard(block: string, listingId: string): NormalizedListing | null {
  // eBay sometimes renders a "Shop on eBay" placeholder card that has a real
  // data-listingid but whose href points to a fake /itm/123456 search page.
  // Require the card's href to reference the same listingId before trusting it.
  const hrefMatch = block.match(/href=https?:\/\/(?:www\.)?ebay\.com\/itm\/([0-9]+)/)
  if (!hrefMatch || hrefMatch[1] !== listingId) return null

  const titleMatch =
    block.match(
      /<div role=heading[^>]*class=s-card__title[^>]*>\s*<span[^>]*>([^<]+)<\/span>/,
    ) ??
    block.match(
      /<div [^>]*class="s-card__title"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/,
    )
  if (!titleMatch) return null
  const title = stripTags(titleMatch[1])
  if (!title) return null

  // Price: pick first $-prefixed price in the card block (eBay sometimes shows
  // "to" ranges; we just take the lower end).
  const priceMatch = block.match(
    /<span class="su-styled-text[^"]*s-card__price[^"]*">\s*\$([\d,]+(?:\.\d+)?)/,
  )
  const priceMinor = priceMatch
    ? Math.round(parseFloat(priceMatch[1].replace(/,/g, '')) * 100)
    : 0

  // Image: <img class=s-card__image ... src="...">
  const imgMatch =
    block.match(/<img[^>]*class=s-card__image[^>]*\bsrc=([^\s>]+)/) ??
    block.match(/<img[^>]*\bsrc=([^\s>]+)[^>]*class=s-card__image/)
  let imageUrl = imgMatch?.[1]
  if (imageUrl) imageUrl = imageUrl.replace(/^"|"$/g, '')
  // eBay sometimes uses a placeholder until intersection-observer swaps it in.
  // Prefer data-defer-load when src is the placeholder.
  if (imageUrl?.includes('fxxj3ttftm5ltcqnto1o4baovyl.png')) {
    const deferMatch = block.match(
      /<img[^>]*class=s-card__image[^>]*\bdata-defer-load=([^\s>]+)/,
    )
    if (deferMatch) imageUrl = deferMatch[1].replace(/^"|"$/g, '')
  }

  // Condition shows in the subtitle row.
  const subtitleMatch = block.match(
    /<div class=s-card__subtitle[^>]*>\s*<span[^>]*>([^<]+)<\/span>/,
  )
  const condition = subtitleMatch ? stripTags(subtitleMatch[1]) : undefined

  return {
    externalId: listingId,
    title,
    url: `https://www.ebay.com/itm/${listingId}`,
    imageUrl,
    priceMinor,
    currency: 'USD',
    sellerName: 'eBay seller',
    availability: condition?.toLowerCase().includes('new') ? 'in_stock' : undefined,
  }
}

function parseSearchHtml(html: string): NormalizedListing[] {
  const cards = findCardStarts(html)
  if (cards.length === 0) return []
  const out: NormalizedListing[] = []
  for (let i = 0; i < cards.length; i++) {
    const start = cards[i].start
    const end = cards[i + 1]?.start ?? Math.min(start + 12000, html.length)
    const block = html.slice(start, end)
    const listing = parseCard(block, cards[i].listingId)
    if (listing) out.push(listing)
  }
  return out
}

export function createEbayAdapter(id: string, label: string): Adapter {
  return {
    id,
    label,
    type: 'ebay',
    async search(query, signal): Promise<NormalizedListing[]> {
      const cookies = await getCookies(signal)

      const url = new URL('https://www.ebay.com/sch/i.html')
      url.searchParams.set('_nkw', query)

      const res = await fetch(url, {
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          referer: 'https://www.ebay.com/',
          cookie: cookies,
        },
      })
      if (!res.ok) {
        cookieCache = null
        throw new Error(`eBay: HTTP ${res.status}`)
      }

      const html = await readTextLimited(res, 6_000_000)
      if (html.length < 5000 && html.includes('Error Page')) {
        cookieCache = null
        throw new Error('eBay: blocked')
      }

      return parseSearchHtml(html).slice(0, 12)
    },
  }
}
