import type { Adapter, NormalizedListing } from './types'

type ShopifyProduct = {
  id: number | string
  title: string
  url: string
  image?: string | null
  price?: string | number | null
  vendor?: string | null
}

type SuggestResponse = {
  resources?: {
    results?: {
      products?: ShopifyProduct[]
    }
  }
}

function parsePriceToMinor(price: string | number | null | undefined): number {
  if (price == null) return 0
  const n = typeof price === 'string' ? parseFloat(price) : price
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

export function createShopifyAdapter(opts: {
  id: string
  label: string
  domain: string
  currency?: string
  limit?: number
}): Adapter {
  const { id, label, domain, currency = 'USD', limit = 10 } = opts
  const base = domain.startsWith('http') ? domain.replace(/\/$/, '') : `https://${domain}`

  return {
    id,
    label,
    type: 'shopify',
    async search(query, signal): Promise<NormalizedListing[]> {
      const url = new URL('/search/suggest.json', base)
      url.searchParams.set('q', query)
      url.searchParams.set('resources[type]', 'product')
      url.searchParams.set('resources[limit]', String(limit))

      const res = await fetch(url, {
        signal,
        headers: {
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        },
      })

      if (!res.ok) {
        const hint =
          res.status === 403
            ? ' (storefront is blocking automated requests)'
            : res.status === 404
              ? ' (suggest endpoint not available on this storefront)'
              : ''
        throw new Error(`${label}: HTTP ${res.status}${hint}`)
      }

      const data = (await res.json()) as SuggestResponse
      const products = data.resources?.results?.products ?? []

      return products.map((p) => ({
        externalId: String(p.id),
        title: p.title,
        url: p.url.startsWith('http') ? p.url : `${base}${p.url}`,
        imageUrl: p.image ?? undefined,
        priceMinor: parsePriceToMinor(p.price),
        currency,
        sellerName: p.vendor ?? label,
      }))
    },
  }
}
