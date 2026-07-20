import type { NormalizedListing } from './adapters/types'
import { hasTokenOverlap } from './text'
import { isSafeRemoteUrl } from './url-safety'

const MAX_INT = 2_147_483_647

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().slice(0, maxLength)
  return cleaned || undefined
}

function cleanOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanCount(value: unknown): number | undefined {
  const count = cleanOptionalNumber(value)
  return count !== undefined && count >= 0 && count <= MAX_INT ? Math.round(count) : undefined
}

function cleanRange(value: unknown, min: number, max: number): number | undefined {
  const number = cleanOptionalNumber(value)
  return number !== undefined && number >= min && number <= max ? number : undefined
}

function sanitizeListing(listing: NormalizedListing): NormalizedListing | null {
  const title = cleanText(listing.title, 500)
  const url = cleanText(listing.url, 2_000)
  if (!title || !url || !isSafeRemoteUrl(url)) return null

  const externalId = cleanText(listing.externalId, 500) ?? url
  const price = cleanOptionalNumber(listing.priceMinor)
  if (price === undefined || price < 0 || price > MAX_INT) return null

  const currency = cleanText(listing.currency, 3)?.toUpperCase()
  const imageUrl = cleanText(listing.imageUrl, 2_000)
  const shipping = cleanOptionalNumber(listing.shippingMinor)

  return {
    ...listing,
    externalId,
    title,
    url,
    imageUrl:
      imageUrl &&
      ((imageUrl.startsWith('/') && !imageUrl.startsWith('//')) || isSafeRemoteUrl(imageUrl))
        ? imageUrl
        : undefined,
    priceMinor: Math.round(price),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
    shippingMinor:
      shipping !== undefined && shipping >= 0 && shipping <= MAX_INT
        ? Math.round(shipping)
        : undefined,
    sellerName: cleanText(listing.sellerName, 200),
    detailsText: cleanText(listing.detailsText, 2_000),
    sellerRating: cleanRange(listing.sellerRating, 0, 100),
    reviewCount: cleanCount(listing.reviewCount),
    reviewAvg: cleanRange(listing.reviewAvg, 0, 5),
  }
}

export function adapterSearchKey(adapterId: string, query: string): string {
  return `${adapterId}\u0000${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

function listingQuality(listing: NormalizedListing): number {
  let score = 0
  if (listing.priceMinor > 0) score += 8
  if (!/^sponsored(?: ad)?\s*[-:]/i.test(listing.title)) score += 4
  if (listing.imageUrl) score += 2
  if (listing.detailsText) score += 1
  return score
}

/**
 * One adapter result must contain at most one row per external ID. Retailer
 * pages can repeat the same product in sponsored and organic slots; allowing
 * both through causes duplicate cards, duplicate React keys, and repeated DB
 * upserts. Prefer the richer/priced copy while preserving result order.
 */
export function dedupeListings(listings: NormalizedListing[]): NormalizedListing[] {
  const byId = new Map<string, NormalizedListing>()
  for (const unsafeListing of listings) {
    const listing = sanitizeListing(unsafeListing)
    if (!listing) continue
    const key = listing.externalId.trim() || listing.url
    const current = byId.get(key)
    if (!current || listingQuality(listing) > listingQuality(current)) {
      byId.set(key, listing)
    }
  }
  return [...byId.values()]
}

/**
 * Persisted listings are retailer history, not a query-specific cache. On a
 * failed live search, require every meaningful query token to match before a
 * historical row can be considered. Precision matters more than recall here:
 * returning nothing is better than showing results from the previous query.
 */
export function cachedListingsForQuery(
  query: string,
  listings: NormalizedListing[],
): NormalizedListing[] {
  return listings.filter((listing) => hasTokenOverlap(query, listing.title))
}
