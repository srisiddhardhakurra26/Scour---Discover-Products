import * as cheerio from 'cheerio'
import type { NormalizedListing } from './types'

// schema.org/Product structured data, when a store embeds it on its search
// results page, gives exact title/price/availability with zero selector
// fragility — layout redesigns don't touch it. The onboarder prefers this
// over LLM-derived CSS selectors; the LLM path is the fallback for stores
// without JSON-LD.

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
type JsonObject = { [k: string]: JsonValue }

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function typeMatches(node: JsonObject, type: string): boolean {
  const t = node['@type']
  if (typeof t === 'string') return t.toLowerCase() === type.toLowerCase()
  if (Array.isArray(t)) {
    return t.some((x) => typeof x === 'string' && x.toLowerCase() === type.toLowerCase())
  }
  return false
}

/** Walk any JSON-LD shape (@graph, ItemList, arrays) collecting Product nodes. */
function collectProducts(node: JsonValue, out: JsonObject[], depth = 0): void {
  if (depth > 6) return
  if (Array.isArray(node)) {
    for (const item of node) collectProducts(item, out, depth + 1)
    return
  }
  if (!isObject(node)) return

  if (typeMatches(node, 'Product')) {
    out.push(node)
    return
  }
  if (node['@graph']) collectProducts(node['@graph'], out, depth + 1)
  if (typeMatches(node, 'ItemList') && node.itemListElement) {
    collectProducts(node.itemListElement, out, depth + 1)
  }
  if (typeMatches(node, 'ListItem') && node.item) {
    collectProducts(node.item, out, depth + 1)
  }
}

function firstString(v: JsonValue | undefined): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = firstString(item)
      if (s) return s
    }
    return undefined
  }
  if (isObject(v)) {
    // ImageObject and friends keep the value under url/contentUrl.
    return firstString(v.url) ?? firstString(v.contentUrl) ?? firstString(v['@id'])
  }
  return undefined
}

function parsePriceMinor(v: JsonValue | undefined): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100)
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(n)) return Math.round(n * 100)
  }
  return 0
}

type OfferInfo = {
  priceMinor: number
  currency?: string
  availability?: NormalizedListing['availability']
}

function parseAvailability(v: JsonValue | undefined): NormalizedListing['availability'] {
  const s = firstString(v)?.toLowerCase()
  if (!s) return undefined
  if (s.includes('instock') || s.includes('limitedavailability')) return 'in_stock'
  if (s.includes('outofstock') || s.includes('soldout') || s.includes('discontinued')) {
    return 'out'
  }
  return undefined
}

function parseOffers(offers: JsonValue | undefined): OfferInfo {
  if (Array.isArray(offers)) {
    for (const o of offers) {
      const info = parseOffers(o)
      if (info.priceMinor > 0) return info
    }
    return { priceMinor: 0 }
  }
  if (!isObject(offers)) return { priceMinor: 0 }
  // AggregateOffer carries lowPrice; a plain Offer carries price (sometimes
  // nested under priceSpecification).
  const spec = isObject(offers.priceSpecification) ? offers.priceSpecification : undefined
  const priceMinor =
    parsePriceMinor(offers.price) ||
    parsePriceMinor(offers.lowPrice) ||
    (spec ? parsePriceMinor(spec.price) : 0)
  const currency =
    firstString(offers.priceCurrency) ?? (spec ? firstString(spec.priceCurrency) : undefined)
  return { priceMinor, currency, availability: parseAvailability(offers.availability) }
}

function absoluteUrl(url: string, domain: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `https://${domain}${url.startsWith('/') ? '' : '/'}${url}`
}

/**
 * Extract product listings from JSON-LD blocks in a page. Same bar as the
 * selector-based extractor: a product is only emitted with both a title and a
 * product URL. Capped at 12, deduped by URL.
 */
export function extractJsonLdListings(
  html: string,
  domain: string,
  label: string,
  currencyFallback = 'USD',
): NormalizedListing[] {
  let $: cheerio.CheerioAPI
  try {
    $ = cheerio.load(html)
  } catch {
    return []
  }

  const products: JsonObject[] = []
  $('script[type="application/ld+json"]').each((_i, el) => {
    const text = $(el).text()
    if (!text.trim()) return
    try {
      collectProducts(JSON.parse(text) as JsonValue, products)
    } catch {
      // malformed block — skip it, others may parse
    }
  })

  const seen = new Set<string>()
  const results: NormalizedListing[] = []
  for (const p of products) {
    if (results.length >= 12) break
    const title = firstString(p.name)
    const rawUrl = firstString(p.url) ?? firstString(p['@id'])
    if (!title || !rawUrl) continue
    const url = absoluteUrl(rawUrl, domain)
    if (seen.has(url)) continue
    seen.add(url)

    const offer = parseOffers(p.offers)
    const brand = isObject(p.brand) ? firstString(p.brand.name) : firstString(p.brand)
    const description = firstString(p.description)
    const image = firstString(p.image)

    results.push({
      externalId: url,
      title,
      url,
      imageUrl: image ? absoluteUrl(image, domain) : undefined,
      priceMinor: offer.priceMinor,
      currency: offer.currency ?? currencyFallback,
      availability: offer.availability,
      sellerName: brand ?? label,
      detailsText: description ? description.slice(0, 400) : undefined,
    })
  }
  return results
}
