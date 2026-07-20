import type { Adapter, NormalizedListing } from './types'
import { readJsonLimited } from '@/lib/http'

type WooImage = { src?: string; thumbnail?: string }
type WooPrices = {
  price?: string
  regular_price?: string
  sale_price?: string
  currency_code?: string
  currency_minor_unit?: number
}
type WooProduct = {
  id: number | string
  name: string
  permalink: string
  sku?: string
  images?: WooImage[]
  prices?: WooPrices
}

export function createWooCommerceAdapter(opts: {
  id: string
  label: string
  domain: string
}): Adapter {
  const { id, label, domain } = opts
  const base = domain.startsWith('http') ? domain.replace(/\/$/, '') : `https://${domain}`

  return {
    id,
    label,
    type: 'woocommerce',
    async search(query, signal): Promise<NormalizedListing[]> {
      const url = new URL('/wp-json/wc/store/v1/products', base)
      url.searchParams.set('search', query)
      url.searchParams.set('per_page', '10')

      const res = await fetch(url, {
        signal,
        headers: {
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        },
      })
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)

      const products = await readJsonLimited<WooProduct[]>(res, 3_000_000)

      return products.map((p) => {
        const minorUnit = p.prices?.currency_minor_unit ?? 2
        const rawPrice = p.prices?.price ?? p.prices?.sale_price ?? p.prices?.regular_price ?? '0'
        // WooCommerce Store API returns prices as integer-string in the currency's minor unit
        // (e.g. "2999" for $29.99 when minor_unit=2). Normalize to our cents.
        const asInt = parseInt(rawPrice, 10)
        const priceMinor = Number.isFinite(asInt)
          ? Math.round(asInt * Math.pow(10, 2 - minorUnit))
          : 0

        return {
          externalId: String(p.id),
          title: p.name,
          url: p.permalink,
          imageUrl: p.images?.[0]?.src ?? p.images?.[0]?.thumbnail,
          priceMinor,
          currency: p.prices?.currency_code ?? 'USD',
          sellerName: label,
        }
      })
    },
  }
}
