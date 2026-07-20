import * as cheerio from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { NormalizedListing } from './types'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'
import { extractJsonLdListings } from './jsonld'
import { isStorefrontUrl, resolveSafeHttpUrl } from '@/lib/url-safety'

export function parsePriceMinor(text: string): number {
  const m = text.match(/(\d[\d\s.,'’]*)/)
  if (!m) return 0
  const raw = m[1].replace(/[\s'’]/g, '').replace(/[.,]+$/, '')
  const lastDot = raw.lastIndexOf('.')
  const lastComma = raw.lastIndexOf(',')
  const lastSeparator = Math.max(lastDot, lastComma)
  const digitsAfter = lastSeparator >= 0 ? raw.length - lastSeparator - 1 : 0
  const decimalSeparator =
    lastDot >= 0 && lastComma >= 0
      ? raw[lastSeparator]
      : digitsAfter === 1 || digitsAfter === 2
        ? raw[lastSeparator]
        : null

  let normalized: string
  if (decimalSeparator) {
    const integer = raw.slice(0, lastSeparator).replace(/[.,]/g, '')
    const fraction = raw.slice(lastSeparator + 1).replace(/[.,]/g, '')
    normalized = `${integer}.${fraction}`
  } else {
    normalized = raw.replace(/[.,]/g, '')
  }
  const num = Number(normalized)
  const minor = Math.round(num * 100)
  return Number.isFinite(minor) && minor >= 0 && minor <= 2_147_483_647 ? minor : 0
}

function pickAttr(el: Cheerio<AnyNode>, attrs: string[]): string | undefined {
  for (const a of attrs) {
    const v = el.attr(a)
    if (v && v.trim()) return v.trim()
  }
  return undefined
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
  let $: cheerio.CheerioAPI
  let cards: Cheerio<AnyNode>
  try {
    $ = cheerio.load(html)
    cards = $(productSelector)
  } catch {
    return []
  }
  const results: NormalizedListing[] = []
  const prefix = config.urlPrefix ?? `https://${domain}`
  const currency = config.currency ?? 'USD'

  cards.each((i, el) => {
    if (results.length >= 12) return false
    try {
      const card = $(el)

      const title = card.find(titleSelector).first().text().trim()
      if (!title) return
      const priceText = card.find(priceSelector).first().text().trim()
      const priceMinor = parsePriceMinor(priceText)

      const link = card.find(urlSelector).first()
      const href = pickAttr(link, ['href'])
      if (!href) return
      const productUrl = resolveSafeHttpUrl(href, prefix)
      if (!productUrl || !isStorefrontUrl(productUrl, domain)) return

      const img = card.find(imageSelector).first()
      const rawSrc = pickAttr(img, ['src', 'data-src', 'data-original', 'data-lazy-src'])
      const imageUrl = resolveSafeHttpUrl(rawSrc, prefix)

      results.push({
        externalId: productUrl,
        title,
        url: productUrl,
        imageUrl,
        priceMinor,
        currency,
        sellerName: config.brandName ?? label,
      })
    } catch {
      // A malformed generated selector should skip this card, not fail search.
    }
    return
  })

  return results
}
