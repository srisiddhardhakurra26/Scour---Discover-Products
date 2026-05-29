import * as cheerio from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { Adapter, NormalizedListing } from './types'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'
import { renderPage } from '@/lib/browser'

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

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

export function createGenericHtmlAdapter(
  id: string,
  label: string,
  domain: string,
  config: GenericHtmlConfig,
): Adapter {
  return {
    id,
    label,
    type: 'generic-html',
    async search(query, signal): Promise<NormalizedListing[]> {
      const url = config.searchUrlTemplate.replace('{query}', encodeURIComponent(query))

      let html: string
      if (config.requiresJs) {
        // Render with Chromium so SPA-rendered cards exist in the DOM.
        const rendered = await renderPage(url, 18_000)
        html = rendered.html
      } else {
        const res = await fetch(url, {
          signal,
          headers: {
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': REALISTIC_UA,
            referer: `https://${domain}/`,
          },
        })
        if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
        html = await res.text()
      }

      const $ = cheerio.load(html)
      const cards = $(config.productSelector)
      const results: NormalizedListing[] = []
      const prefix = config.urlPrefix ?? `https://${domain}`
      const currency = config.currency ?? 'USD'

      cards.each((i, el) => {
        if (results.length >= 12) return false
        const card = $(el)

        const title = card.find(config.titleSelector).first().text().trim()
        if (!title) return
        const priceText = card.find(config.priceSelector).first().text().trim()
        const priceMinor = parsePriceMinor(priceText)

        const link = card.find(config.urlSelector).first()
        const href = pickAttr(link, ['href'])
        if (!href) return
        const productUrl = absoluteUrl(href, prefix)

        const img = card.find(config.imageSelector).first()
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
    },
  }
}
