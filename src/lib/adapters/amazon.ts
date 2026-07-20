import type { Adapter, NormalizedListing } from './types'
import { readTextLimited } from '@/lib/http'

// Real Amazon adapter — scrapes the public search page. No API, no key. Will
// occasionally be served a bot-check page instead of results; we detect that
// and surface it as an error so the section quietly hides for that request.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function isBotChallenge(html: string): boolean {
  return (
    html.includes('Enter the characters you see below') ||
    html.includes('To discuss automated access to Amazon data') ||
    html.includes('Sorry, we just need to make sure') ||
    html.includes('/errors/validateCaptcha')
  )
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

type CardMatch = { asin: string; start: number }

function findCardStarts(html: string): CardMatch[] {
  const re = /data-asin="(B0[A-Z0-9]{8})"[^>]*data-component-type="s-search-result"/g
  const matches: CardMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    matches.push({ asin: m[1], start: m.index })
  }
  return matches
}

function parseCard(block: string, asin: string): NormalizedListing | null {
  // Title: amazon renders it as <h2 ...><a ...><span>Title</span></a></h2>
  // but markup varies across page variants — try a few patterns.
  const titlePatterns = [
    /<h2[^>]*aria-label="([^"]+)"/,
    /<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/h2>/,
    /<span class="a-size-base-plus[^"]*">([^<]+)<\/span>/,
    /<span class="a-size-medium[^"]*">([^<]+)<\/span>/,
  ]
  let title = ''
  for (const re of titlePatterns) {
    const m = block.match(re)
    if (m) {
      title = stripTags(m[1])
      if (title.length > 0) break
    }
  }
  if (!title) return null

  // Price: take the first .a-offscreen — Amazon repeats it for whole-vs-fraction
  // displays; the offscreen version is the canonical "$XX.XX" form.
  const priceMatch = block.match(/<span class="a-offscreen">\$([\d,]+(?:\.\d+)?)<\/span>/)
  const priceMinor = priceMatch
    ? Math.round(parseFloat(priceMatch[1].replace(/,/g, '')) * 100)
    : 0

  const imgMatch = block.match(/<img[^>]+class="s-image"[^>]+src="([^"]+)"/)
  const imageUrl = imgMatch?.[1]

  const ratingMatch = block.match(/([\d.]+) out of 5 stars/)
  const reviewAvg = ratingMatch ? parseFloat(ratingMatch[1]) : undefined

  const countMatch = block.match(/aria-label="([\d,]+) ratings?"/)
  const reviewCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : undefined

  return {
    externalId: asin,
    title,
    url: `https://www.amazon.com/dp/${asin}`,
    imageUrl,
    priceMinor,
    currency: 'USD',
    sellerName: 'Amazon',
    reviewAvg,
    reviewCount,
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
    const listing = parseCard(block, cards[i].asin)
    if (listing) out.push(listing)
  }
  return out
}

export function createAmazonAdapter(id: string, label: string): Adapter {
  return {
    id,
    label,
    type: 'amazon',
    async search(query, signal): Promise<NormalizedListing[]> {
      const url = new URL('https://www.amazon.com/s')
      url.searchParams.set('k', query)
      url.searchParams.set('ref', 'nb_sb_noss')

      const res = await fetch(url, {
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          'upgrade-insecure-requests': '1',
        },
      })
      if (!res.ok) throw new Error(`Amazon: HTTP ${res.status}`)

      const html = await readTextLimited(res, 6_000_000)
      if (isBotChallenge(html)) throw new Error('Amazon: bot challenge')

      return parseSearchHtml(html).slice(0, 12)
    },
  }
}
