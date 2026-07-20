import type { Adapter, NormalizedListing } from './types'
import { normalizeStorefrontDomain } from '@/lib/url-safety'
import { readJsonLimited } from '@/lib/http'

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
  tags?: string[] | string | null
  body_html?: string | null
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

// Attribute evidence for the LLM relevance judge: bare-SKU titles ("Men's
// Aerocork #2689") never state material/feature words, but the catalog's
// type/tags/description usually do ("rich brown suede", "premium leather").
// Capped tight — 40 judged candidates ride in one prompt.
//
// Tags are filtered to human-readable ones: stores like Allbirds use them as
// machine metadata ("allbirds::cfId => color-mens-zeffer-straps"), which is
// noise in a judge prompt, not evidence.
function humanTags(tags: string[] | string | null | undefined): string {
  const list = Array.isArray(tags) ? tags : tags ? [tags] : []
  return list
    .filter((t) => t.length <= 40 && !/[:=>_]|undefined/.test(t))
    .join(' ')
}

function detailsTextOf(p: ShopifyCatalogProduct): string | undefined {
  const body = (p.body_html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  const out = [p.product_type ?? '', humanTags(p.tags), body]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return out.length > 0 ? out : undefined
}

// --- Catalog cache (module-level, stale-while-revalidate) -------------------
// The catalog is query-independent, so refetching it on every search is pure
// downside: during a fan-out the process is busy (parallel fetches, Playwright
// for generic-html sources), and even a fast storefront (~1s cold, ~0.2s warm
// measured against blundstone.com) can miss the adapter timeout on contention
// alone — which made a store flicker in and out of results between visits.
// Serve from memory when fresh, serve stale + revalidate in the background
// (generous timeout, off the critical path), and only block on the network
// when cold. Boot prewarm (instrumentation.ts) makes even the first search of
// a session warm. The DB fallback in fanout.ts remains the net under all of
// this (process restarts, cold fetch failures).
const CATALOG_FRESH_MS = 10 * 60 * 1000
const CATALOG_USABLE_MS = 60 * 60 * 1000
const REVALIDATE_TIMEOUT_MS = 10_000

type CatalogEntry = {
  products: ShopifyCatalogProduct[]
  fetchedAt: number
  refreshing: boolean
}
const catalogCache = new Map<string, CatalogEntry>()

function baseOf(domain: string): string {
  return domain.startsWith('http') ? domain.replace(/\/$/, '') : `https://${domain}`
}

async function fetchCatalog(
  base: string,
  label: string,
  limit: number,
  signal: AbortSignal,
): Promise<ShopifyCatalogProduct[]> {
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

  const data = await readJsonLimited<ProductsResponse>(res, 12_000_000)
  return data.products ?? []
}

async function loadCatalog(
  base: string,
  label: string,
  limit: number,
  signal: AbortSignal,
): Promise<ShopifyCatalogProduct[]> {
  const hit = catalogCache.get(base)
  const age = hit ? Date.now() - hit.fetchedAt : Infinity
  if (hit && age < CATALOG_FRESH_MS) return hit.products
  if (hit && age < CATALOG_USABLE_MS) {
    revalidateCatalog(base, label, limit)
    return hit.products
  }
  const products = await fetchCatalog(base, label, limit, signal)
  catalogCache.set(base, { products, fetchedAt: Date.now(), refreshing: false })
  return products
}

// Fire-and-forget refresh; the entry keeps serving until it succeeds. Guarded
// so concurrent searches don't stampede the storefront.
function revalidateCatalog(base: string, label: string, limit: number): void {
  const hit = catalogCache.get(base)
  if (!hit || hit.refreshing) return
  hit.refreshing = true
  void fetchCatalog(base, label, limit, AbortSignal.timeout(REVALIDATE_TIMEOUT_MS))
    .then((products) => {
      catalogCache.set(base, { products, fetchedAt: Date.now(), refreshing: false })
    })
    .catch((err) => {
      hit.refreshing = false
      console.warn(`[shopify] ${label}: background refresh failed:`, err instanceof Error ? err.message : err)
    })
}

/**
 * Warm a storefront's catalog into the in-memory cache. Called at server
 * start (instrumentation.ts) so the first search of a session doesn't race a
 * cold fetch against the adapter timeout. No-op when already fresh.
 */
export async function prewarmShopifyCatalog(domain: string, label?: string): Promise<number> {
  if (normalizeStorefrontDomain(domain) !== domain.toLowerCase()) {
    throw new Error('Invalid Shopify storefront domain')
  }
  const base = baseOf(domain)
  const hit = catalogCache.get(base)
  if (hit && Date.now() - hit.fetchedAt < CATALOG_FRESH_MS) return hit.products.length
  const products = await fetchCatalog(base, label ?? domain, 250, AbortSignal.timeout(REVALIDATE_TIMEOUT_MS))
  catalogCache.set(base, { products, fetchedAt: Date.now(), refreshing: false })
  return products.length
}

export function createShopifyAdapter(opts: {
  id: string
  label: string
  domain: string
  currency?: string
  limit?: number
}): Adapter {
  const { id, label, domain, currency = 'USD', limit = 250 } = opts
  const base = baseOf(domain)

  return {
    id,
    label,
    type: 'shopify',
    // The query is intentionally unused: we fetch the catalog and let Scour's
    // local embedding ranker decide relevance (see fetchCatalog).
    async search(_query, signal): Promise<NormalizedListing[]> {
      const products = await loadCatalog(base, label, limit, signal)

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
          detailsText: detailsTextOf(p),
        }
      })
    },
  }
}
