import type { Adapter, NormalizedListing } from './types'
import { findCatalog } from './mock-catalog'

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const EBAY_SELLERS = ['top_seller_99', 'deal_emporium', 'gadget_garage', 'vintage_haven', 'price_drop_kings']

export function createMockEbayAdapter(id: string, label: string): Adapter {
  return {
    id,
    label,
    type: 'mock',
    async search(query, signal): Promise<NormalizedListing[]> {
      const delayMs = 800 + (hash(query) % 800)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delayMs)
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new Error('aborted'))
        })
      })

      const products = findCatalog(query)
      return products.map((p, i) => {
        const id = `ebay-${hash(p.name)}`
        // eBay mock: usually slightly under MSRP, occasional "used" steep discount
        const discount = hash(`ebay-${p.name}`) % 100
        const used = discount > 80
        const priceMinor = used
          ? Math.round(p.basePriceCents * 0.55)
          : p.basePriceCents - (hash(`ebay-px-${p.name}`) % 400)
        const title = used ? `${p.name} (Pre-Owned)` : p.name
        return {
          externalId: id,
          title,
          // Search URL works on real eBay (vs fake /itm/ pages that 404).
          url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(p.name)}`,
          imageUrl: `/api/mock-image?text=${encodeURIComponent(title)}`,
          priceMinor: Math.max(priceMinor, 100),
          currency: 'USD',
          sellerName: EBAY_SELLERS[i % EBAY_SELLERS.length],
          sellerRating: 4 + ((hash(`r-${p.name}`) % 10) / 10),
          reviewCount: 50 + (hash(p.name) % 400),
        }
      })
    },
  }
}
