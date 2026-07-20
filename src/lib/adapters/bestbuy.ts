import type { Adapter, NormalizedListing } from './types'
import { readJsonLimited } from '@/lib/http'

type BestBuyProduct = {
  sku: number | string
  name: string
  url: string
  image?: string
  salePrice?: number
  regularPrice?: number
  manufacturer?: string
  onSale?: boolean
  customerReviewAverage?: number
  customerReviewCount?: number
}

type BestBuyResponse = {
  products?: BestBuyProduct[]
}

export function createBestBuyAdapter(id: string, label: string): Adapter | null {
  const apiKey = process.env.BESTBUY_API_KEY
  if (!apiKey) return null

  return {
    id,
    label,
    type: 'bestbuy',
    async search(query, signal): Promise<NormalizedListing[]> {
      const fields = [
        'sku',
        'name',
        'url',
        'image',
        'salePrice',
        'regularPrice',
        'manufacturer',
        'onSale',
        'customerReviewAverage',
        'customerReviewCount',
      ].join(',')
      const url = `https://api.bestbuy.com/v1/products(search=${encodeURIComponent(query)})?apiKey=${apiKey}&format=json&pageSize=10&show=${fields}`

      const res = await fetch(url, {
        signal,
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)

      const data = await readJsonLimited<BestBuyResponse>(res, 3_000_000)
      return (data.products ?? []).map((p) => ({
        externalId: String(p.sku),
        title: p.name,
        url: p.url,
        imageUrl: p.image,
        priceMinor: Math.round(((p.salePrice ?? p.regularPrice) ?? 0) * 100),
        currency: 'USD',
        sellerName: p.manufacturer ?? 'Best Buy',
        reviewAvg: p.customerReviewAverage,
        reviewCount: p.customerReviewCount,
      }))
    },
  }
}
