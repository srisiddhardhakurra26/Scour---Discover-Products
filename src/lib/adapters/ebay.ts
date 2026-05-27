import type { Adapter, NormalizedListing } from './types'

type EbayItem = {
  itemId: string
  title: string
  itemWebUrl: string
  image?: { imageUrl?: string }
  thumbnailImages?: Array<{ imageUrl?: string }>
  price?: { value?: string; currency?: string }
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number }
  shippingOptions?: Array<{ shippingCost?: { value?: string } }>
  condition?: string
}

type EbaySearchResponse = {
  itemSummaries?: EbayItem[]
  warnings?: Array<{ message: string }>
}

type CachedToken = { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null

async function getEbayToken(): Promise<string> {
  const appId = process.env.EBAY_APP_ID
  const certId = process.env.EBAY_CERT_ID
  if (!appId || !certId) throw new Error('eBay creds missing')

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const auth = Buffer.from(`${appId}:${certId}`).toString('base64')
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`eBay OAuth HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return data.access_token
}

export function createEbayAdapter(id: string, label: string): Adapter | null {
  if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID) return null

  return {
    id,
    label,
    type: 'ebay',
    async search(query, signal): Promise<NormalizedListing[]> {
      const token = await getEbayToken()
      const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
      url.searchParams.set('q', query)
      url.searchParams.set('limit', '10')

      const res = await fetch(url, {
        signal,
        headers: {
          authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          accept: 'application/json',
        },
      })
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)

      const data = (await res.json()) as EbaySearchResponse
      return (data.itemSummaries ?? []).map((item) => {
        const priceVal = parseFloat(item.price?.value ?? '0')
        const shippingVal = parseFloat(item.shippingOptions?.[0]?.shippingCost?.value ?? '0')
        const feedbackPct = item.seller?.feedbackPercentage
          ? parseFloat(item.seller.feedbackPercentage) / 100
          : undefined
        return {
          externalId: item.itemId,
          title: item.title,
          url: item.itemWebUrl,
          imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl,
          priceMinor: Math.round(priceVal * 100),
          currency: item.price?.currency ?? 'USD',
          shippingMinor: Number.isFinite(shippingVal) ? Math.round(shippingVal * 100) : undefined,
          sellerName: item.seller?.username,
          sellerRating: feedbackPct ? Math.round(feedbackPct * 50) / 10 : undefined,
          reviewCount: item.seller?.feedbackScore,
          availability: item.condition === 'New' ? 'in_stock' : undefined,
        }
      })
    },
  }
}
