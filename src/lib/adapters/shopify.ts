import type { Adapter, NormalizedListing } from './types'

type ShopifyVariant = {
  price?: string | number | null
  available?: boolean
}

type ShopifyImage = {
  src?: string | null
}

type ShopifyCatalogProduct = {
  id: number | string
  title: string
  handle: string
  vendor?: string | null
  product_type?: string | null
  variants?: ShopifyVariant[]
  images?: ShopifyImage[]
}

type ProductsResponse = {
  products?: ShopifyCatalogProduct[]
}

// "From" price: the cheapest in-catalog variant. Ignores zero/blank prices.
function minVariantPriceMinor(variants: ShopifyVariant[] | undefined): number {
  if (!variants || variants.length === 0) return 0
  let min = Infinity
  for (const v of variants) {
    const n = typeof v.price === 'string' ? parseFloat(v.price) : (v.price ?? NaN)
    if (Number.isFinite(n) && n > 0 && n < min) min = n
  }
  return min === Infinity ? 0 : Math.round(min * 100)
}

// Some stores title products with bare SKUs ("Men's Lug #2240"), which carry no
// semantic signal for the relevance ranker. Append the product_type ("Boots")
// when it isn't already in the title so a query like "shoes" can match it.
// Descriptive titles ("Men's Tree Runners") already containing the type are
// left untouched.
function titleWithType(title: string, productType: string | null | undefined): string {
  const type = (productType ?? '').trim()
  if (!type) return title
  return title.toLowerCase().includes(type.toLowerCase()) ? title : `${title} ${type}`
}

export function createShopifyAdapter(opts: {
  id: string
  label: string
  domain: string
  currency?: string
  limit?: number
}): Adapter {
  const { id, label, domain, currency = 'USD', limit = 250 } = opts
  const base = domain.startsWith('http') ? domain.replace(/\/$/, '') : `https://${domain}`

  return {
    id,
    label,
    type: 'shopify',
    // The query is intentionally unused: we fetch the catalog and let Scour's
    // local embedding ranker decide relevance (see below).
    async search(_query, signal): Promise<NormalizedListing[]> {
      // Pull the catalog (/products.json) rather than the keyword suggester
      // (/search/suggest.json). The suggester only matches the literal query
      // against the store's indexed title/tag text, so a brand whose products
      // don't echo the query word — Blundstone boots vs. "shoes" — returns
      // nothing relevant, and Scour's semantic matching never sees the real
      // products. Fetching the catalog moves the relevance decision to the
      // local embedding ranker, which understands "shoes" ~ "boots".
      const url = new URL('/products.json', base)
      url.searchParams.set('limit', String(limit))

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
              ? ' (products.json not available on this storefront)'
              : ''
        throw new Error(`${label}: HTTP ${res.status}${hint}`)
      }

      const data = (await res.json()) as ProductsResponse
      const products = data.products ?? []

      return products.map((p) => {
        const variants = p.variants ?? []
        const inStock = variants.some((v) => v.available)
        return {
          externalId: String(p.id),
          title: titleWithType(p.title, p.product_type),
          url: `${base}/products/${p.handle}`,
          imageUrl: p.images?.[0]?.src ?? undefined,
          priceMinor: minVariantPriceMinor(variants),
          currency,
          availability: variants.length > 0 ? (inStock ? 'in_stock' : 'out') : undefined,
          sellerName: p.vendor ?? label,
        }
      })
    },
  }
}
