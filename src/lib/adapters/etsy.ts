import type { Adapter, NormalizedListing } from './types'
import { readJsonLimited } from '@/lib/http'

type EtsyListing = {
  listing_id: number
  title: string
  url: string
  description?: string
  price?: { amount: number; divisor: number; currency_code: string }
  shop?: { shop_name?: string }
  images?: Array<{ url_570xN?: string; url_fullxfull?: string }>
  MainImage?: { url_570xN?: string }
}

type EtsyResponse = {
  results?: EtsyListing[]
}

export function createEtsyAdapter(id: string, label: string): Adapter | null {
  const apiKey = process.env.ETSY_API_KEY
  if (!apiKey) return null

  return {
    id,
    label,
    type: 'etsy',
    async search(query, signal): Promise<NormalizedListing[]> {
      const url = new URL('https://openapi.etsy.com/v3/application/listings/active')
      url.searchParams.set('keywords', query)
      url.searchParams.set('limit', '15')
      url.searchParams.set('includes', 'Images,Shop')

      const res = await fetch(url, {
        signal,
        headers: {
          'x-api-key': apiKey,
          accept: 'application/json',
        },
      })
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)

      const data = await readJsonLimited<EtsyResponse>(res, 3_000_000)
      return (data.results ?? []).map((l) => {
        const minor = l.price
          ? Math.round((l.price.amount / Math.max(l.price.divisor, 1)) * 100)
          : 0
        const image =
          l.MainImage?.url_570xN ??
          l.images?.[0]?.url_570xN ??
          l.images?.[0]?.url_fullxfull
        return {
          externalId: String(l.listing_id),
          title: l.title,
          url: l.url,
          imageUrl: image,
          priceMinor: minor,
          currency: l.price?.currency_code ?? 'USD',
          sellerName: l.shop?.shop_name,
        }
      })
    },
  }
}
