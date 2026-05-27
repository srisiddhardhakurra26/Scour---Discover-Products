import type { Adapter, NormalizedListing } from './types'
import { findCatalog } from './mock-catalog'

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function asin(name: string): string {
  return 'B0' + hash(name).toString(36).toUpperCase().padStart(8, '0').slice(0, 8)
}

export function createMockAmazonAdapter(id: string, label: string): Adapter {
  return {
    id,
    label,
    type: 'mock',
    async search(query, signal): Promise<NormalizedListing[]> {
      const delayMs = 350 + (hash(query) % 400)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delayMs)
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new Error('aborted'))
        })
      })

      const products = findCatalog(query)
      return products.map((p) => {
        const id = asin(p.name)
        // Amazon mock: full price + small markup variance, Prime-style seller
        const priceMinor = p.basePriceCents + (hash(`amz-${p.name}`) % 200)
        return {
          externalId: id,
          title: p.name,
          // Search URL works on real Amazon (vs fake /dp/ pages that 404).
          url: `https://www.amazon.com/s?k=${encodeURIComponent(p.name)}`,
          imageUrl: `/api/mock-image?text=${encodeURIComponent(p.name)}`,
          priceMinor,
          currency: 'USD',
          sellerName: 'Amazon.com',
          reviewCount: 1000 + (hash(p.name) % 8000),
          reviewAvg: 4 + ((hash(p.name) % 10) / 10),
        }
      })
    },
  }
}
