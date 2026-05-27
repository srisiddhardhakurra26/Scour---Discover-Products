export type NormalizedListing = {
  externalId: string
  title: string
  url: string
  imageUrl?: string
  priceMinor: number
  currency: string
  shippingMinor?: number
  availability?: 'in_stock' | 'low' | 'out'
  sellerName?: string
  sellerRating?: number
  reviewCount?: number
  reviewAvg?: number
  raw?: unknown
}

export type AdapterResult = {
  retailerId: string
  retailerLabel: string
  retailerType: string
  listings: NormalizedListing[]
  error?: string
  elapsedMs: number
}

export interface Adapter {
  id: string
  label: string
  type: string
  search(query: string, signal: AbortSignal): Promise<NormalizedListing[]>
}
