import { getAdapters, ADAPTER_TIMEOUT_MS } from '@/lib/adapters/registry'
import { searchAllAdapters } from '@/lib/fanout'
import { formatPrice } from '@/lib/format'

/** Sources that are chatter/deals, not product storefronts. */
const NON_SHOP_TYPES = new Set(['reddit', 'rss', 'mock'])

// A lookup query is a full product title, so real matches score high on the
// scale documented in relevance.ts (~0.5+ clearly related, ~0.3 same
// category, ~0.15 off-topic). The fan-out's high-recall floor (0.15) is right
// for browsing but lets catalog-dump junk (a coffee bag against a face serum)
// into a lookup, so gate harder here: alternatives must be at least
// category-adjacent, and the "Save $X" headline must come from a clearly
// related item — never from whatever cheap thing squeaked past the recall gate.
const ALTERNATIVE_MIN_SCORE = 0.35
const CHEAPEST_MIN_SCORE = 0.5

export type LookupOffer = {
  title: string
  priceMinor: number
  currency: string
  store: string
  storeType: string
  url: string
  imageUrl?: string
  score: number
}

export type LookupResult = {
  query: string
  current: {
    title: string
    priceMinor: number | null
    currency: string
    pageHost?: string
  }
  cheapest: LookupOffer | null
  alternatives: LookupOffer[]
  savingsMinor: number | null
  storesSearched: number
  storesHit: number
  scourUrl: string
}

function cleanTitle(raw: string): string {
  let t = raw.trim()
  // Common retailer title suffixes / prefixes
  t = t.replace(/\s*[|\-–—:]\s*(Amazon\.com|eBay|Etsy|Best Buy|Walmart|Target).*$/i, '')
  t = t.replace(/^(Amazon\.com|eBay|Etsy|Best Buy)\s*[:|\-–—]\s*/i, '')
  t = t.replace(/\s+at\s+(Amazon|eBay|Etsy|Best Buy).*$/i, '')
  // Collapse noise and cap length for search
  t = t.replace(/\s+/g, ' ').trim().slice(0, 120)
  return t
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Fan out a product title across shop adapters and return cheaper/same
 * alternatives. Used by the browser extension overlay and the lookup API.
 */
export async function lookupProduct(input: {
  title: string
  priceMinor?: number | null
  currency?: string
  pageUrl?: string
  pageHost?: string
  baseUrl?: string
}): Promise<LookupResult> {
  const query = cleanTitle(input.title)
  const currency = input.currency?.trim() || 'USD'
  const pageHost =
    input.pageHost?.replace(/^www\./, '') || hostOf(input.pageUrl) || undefined
  const currentPrice =
    typeof input.priceMinor === 'number' && input.priceMinor > 0
      ? Math.round(input.priceMinor)
      : null

  const base = (input.baseUrl ?? '').replace(/\/$/, '')
  const scourUrl = `${base}/search?q=${encodeURIComponent(query)}`

  if (!query) {
    return {
      query: '',
      current: { title: input.title, priceMinor: currentPrice, currency, pageHost },
      cheapest: null,
      alternatives: [],
      savingsMinor: null,
      storesSearched: 0,
      storesHit: 0,
      scourUrl,
    }
  }

  const adapters = (await getAdapters()).filter((a) => !NON_SHOP_TYPES.has(a.type))
  const results = await searchAllAdapters(adapters, query, ADAPTER_TIMEOUT_MS)

  const offers: LookupOffer[] = []
  const hitStores = new Set<string>()
  for (const r of results) {
    if (r.failed || r.kept.length === 0) continue
    for (const item of r.kept.slice(0, 5)) {
      if (item.score < ALTERNATIVE_MIN_SCORE) continue
      const listing = item.listing
      if (!listing.priceMinor || listing.priceMinor <= 0) continue
      // Skip offers on the same host the user is already viewing
      const offerHost = hostOf(listing.url)
      if (pageHost && offerHost && (offerHost === pageHost || offerHost.endsWith(`.${pageHost}`))) {
        continue
      }
      hitStores.add(r.adapter.label)
      offers.push({
        title: listing.title,
        priceMinor: listing.priceMinor,
        currency: listing.currency || currency,
        store: r.adapter.label,
        storeType: r.adapter.type,
        url: listing.url,
        imageUrl: listing.imageUrl,
        score: item.score,
      })
    }
  }
  const storesHit = hitStores.size

  // Prefer relevance, then price. Dedupe by store+rough title.
  offers.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score
    return a.priceMinor - b.priceMinor
  })

  const seen = new Set<string>()
  const alternatives: LookupOffer[] = []
  for (const o of offers) {
    const key = `${o.store}|${o.title.slice(0, 40).toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    alternatives.push(o)
    if (alternatives.length >= 8) break
  }

  // Cheapest among clearly-related alternatives only — a weaker match may
  // still be listed, but it never drives the savings headline.
  const priced = alternatives
    .filter((o) => o.score >= CHEAPEST_MIN_SCORE)
    .sort((a, b) => a.priceMinor - b.priceMinor)
  const cheapest = priced[0] ?? null

  let savingsMinor: number | null = null
  if (currentPrice != null && cheapest && cheapest.priceMinor < currentPrice) {
    savingsMinor = currentPrice - cheapest.priceMinor
  }

  return {
    query,
    current: {
      title: query,
      priceMinor: currentPrice,
      currency,
      pageHost,
    },
    cheapest,
    alternatives,
    savingsMinor,
    storesSearched: adapters.length,
    storesHit,
    scourUrl,
  }
}

/** Human one-liner for the overlay badge. */
export function lookupHeadline(result: LookupResult): string {
  if (!result.cheapest) {
    return result.storesHit === 0
      ? 'No other stores found this'
      : 'Compared across stores — no clear cheaper option'
  }
  const price = formatPrice(result.cheapest.priceMinor, result.cheapest.currency)
  if (result.savingsMinor != null && result.savingsMinor > 0) {
    return `Save ${formatPrice(result.savingsMinor, result.current.currency)} at ${result.cheapest.store}`
  }
  return `From ${price} at ${result.cheapest.store}`
}
