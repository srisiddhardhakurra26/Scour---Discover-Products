import * as cheerio from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { NormalizedListing } from './types'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'
import { extractJsonLdListings } from './jsonld'

function parsePriceMinor(text: string): number {
  const m = text.match(/([0-9]+(?:[.,][0-9]+)*)/)
  if (!m) return 0
  const num = parseFloat(m[1].replace(/,/g, ''))
  return Number.isFinite(num) ? Math.round(num * 100) : 0
}

function pickAttr(el: Cheerio<AnyNode>, attrs: string[]): string | undefined {
  for (const a of attrs) {
    const v = el.attr(a)
    if (v && v.trim()) return v.trim()
  }
  return undefined
}

function absoluteUrl(url: string, prefix?: string): string {
  if (/^https?:\/\//i.test(url)) return url
  if (!prefix) return url
  if (url.startsWith('/')) return `${prefix}${url}`
  return `${prefix}/${url}`
}

/**
 * Parse product cards out of search HTML using a config's selectors. A card is
 * only emitted if it yields both a title and a product URL — the same bar the
 * repair agent uses to decide whether a candidate config actually works.
 */
export function extractListings(
  html: string,
  config: GenericHtmlConfig,
  domain: string,
  label: string,
): NormalizedListing[] {
  if (config.extraction === 'jsonld') {
    return extractJsonLdListings(html, domain, label, config.currency)
  }
  const { productSelector, titleSelector, priceSelector, imageSelector, urlSelector } = config
  if (!productSelector || !titleSelector || !priceSelector || !imageSelector || !urlSelector) {
    return []
  }
  const $ = cheerio.load(html)
  const cards = $(productSelector)
  const results: NormalizedListing[] = []
  const prefix = config.urlPrefix ?? `https://${domain}`
  const currency = config.currency ?? 'USD'

  cards.each((i, el) => {
    if (results.length >= 12) return false
    const card = $(el)

    const title = card.find(titleSelector).first().text().trim()
    if (!title) return
    const priceText = card.find(priceSelector).first().text().trim()
    const priceMinor = parsePriceMinor(priceText)

    const link = card.find(urlSelector).first()
    const href = pickAttr(link, ['href'])
    if (!href) return
    const productUrl = absoluteUrl(href, prefix)

    const img = card.find(imageSelector).first()
    const rawSrc = pickAttr(img, ['src', 'data-src', 'data-original', 'data-lazy-src'])
    const imageUrl = rawSrc ? absoluteUrl(rawSrc, prefix) : undefined

    results.push({
      externalId: productUrl,
      title,
      url: productUrl,
      imageUrl,
      priceMinor,
      currency,
      sellerName: config.brandName ?? label,
    })
    return
  })

  return results
}
