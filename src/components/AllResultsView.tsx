import type { Adapter, NormalizedListing } from '@/lib/adapters/types'
import { formatPrice } from '@/lib/format'
import { searchProducts, type SearchProduct } from '@/lib/search-engine'
import { SearchFeedback } from './SearchFeedback'
import type { SortKey, ViewMode } from './SearchToolbar'

const TYPE_DOT: Record<string, string> = {
  shopify: 'bg-emerald-400',
  woocommerce: 'bg-violet-400',
  reddit: 'bg-orange-400',
  rss: 'bg-amber-400',
  ebay: 'bg-blue-400',
  etsy: 'bg-pink-400',
  bestbuy: 'bg-yellow-400',
  amazon: 'bg-cyan-400',
  'generic-html': 'bg-teal-400',
  mock: 'bg-fg-subtle',
}

function landedPrice(listing: NormalizedListing): number {
  return listing.priceMinor > 0
    ? listing.priceMinor + Math.max(0, listing.shippingMinor ?? 0)
    : Number.MAX_SAFE_INTEGER
}

function bestOffer(product: SearchProduct) {
  return [...product.offers].sort(
    (left, right) => landedPrice(left.listing) - landedPrice(right.listing),
  )[0] ?? product.candidate
}

function sortedProducts(products: SearchProduct[], sort: SortKey): SearchProduct[] {
  if (sort === 'relevance') return products
  return [...products].sort((left, right) => {
    const a = bestOffer(left).listing
    const b = bestOffer(right).listing
    const currency = a.currency.localeCompare(b.currency)
    if (currency !== 0) return currency
    return sort === 'price-asc'
      ? landedPrice(a) - landedPrice(b)
      : landedPrice(b) - landedPrice(a)
  })
}

export async function AllResultsView({
  query,
  sort,
  adapters,
  timeoutMs,
  view = 'all',
}: {
  query: string
  sort: SortKey
  adapters: Adapter[]
  timeoutMs: number
  view?: ViewMode
}) {
  const result = await searchProducts({ query, adapters, timeoutMs })
  const products = sortedProducts(result.products, sort)

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-bg-card p-16 text-center">
        <p className="text-sm text-fg-muted">No products passed the relevance and constraint checks.</p>
        <p className="font-mono text-[11px] text-fg-subtle">try a broader product name or remove a required filter</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <IntentSummary result={result} />
      <VerifiedOfferCallout products={products} />
      {view === 'by-source' ? (
        <ProductsBySource products={products} query={query} searchRunId={result.searchRunId} />
      ) : (
        <ProductGrid products={products} query={query} searchRunId={result.searchRunId} />
      )}
    </div>
  )
}

function ProductGrid({ products, query, searchRunId }: { products: SearchProduct[]; query: string; searchRunId: string | null }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.entityKey} product={product} query={query} searchRunId={searchRunId} />
      ))}
    </div>
  )
}

function ProductsBySource({ products, query, searchRunId }: { products: SearchProduct[]; query: string; searchRunId: string | null }) {
  const groups = new Map<string, SearchProduct[]>()
  for (const product of products) {
    const label = bestOffer(product).adapter.label
    groups.set(label, [...(groups.get(label) ?? []), product])
  }
  return (
    <div className="flex flex-col gap-10">
      {[...groups.entries()].map(([label, sourceProducts]) => (
        <section key={label} className="flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="text-sm font-semibold text-fg">{label}</h2>
            <span className="font-mono text-[10px] text-fg-subtle">{sourceProducts.length} distinct products</span>
          </div>
          <ProductGrid products={sourceProducts} query={query} searchRunId={searchRunId} />
        </section>
      ))}
    </div>
  )
}

function IntentSummary({ result }: { result: Awaited<ReturnType<typeof searchProducts>> }) {
  const { spec, diagnostics } = result
  const chips = [
    spec.productType,
    spec.brand,
    spec.model,
    ...spec.must,
    ...spec.mustNot.map((value) => `not ${value}`),
    spec.minPriceMinor !== undefined
      ? `at least ${formatPrice(spec.minPriceMinor, 'USD')}`
      : undefined,
    spec.maxPriceMinor !== undefined
      ? `up to ${formatPrice(spec.maxPriceMinor, 'USD')}`
      : undefined,
  ].filter((value): value is string => Boolean(value))

  return (
    <section className="rounded-xl border border-border bg-bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-fg">Interpreted as</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.length > 0 ? chips.map((chip) => (
              <span key={chip} className="rounded-full border border-border-strong bg-bg-elevated px-2 py-1 text-[10px] text-fg-muted">
                {chip}
              </span>
            )) : (
              <span className="text-[11px] text-fg-muted">a product matching the full phrase</span>
            )}
          </div>
        </div>
        <div className="text-right font-mono text-[10px] leading-5 text-fg-subtle">
          <div>{result.products.length} distinct products · {result.storesHit} stores</div>
          <div>{diagnostics.duplicateOffersCollapsed} duplicate offers grouped · {result.elapsedMs}ms</div>
        </div>
      </div>
    </section>
  )
}

function VerifiedOfferCallout({ products }: { products: SearchProduct[] }) {
  const comparable = products
    .filter((product) => product.offers.length >= 2)
    .map((product) => {
      const offers = [...product.offers]
        .filter((offer) => offer.listing.priceMinor > 0)
        .sort((left, right) => landedPrice(left.listing) - landedPrice(right.listing))
      const sameCurrency = offers.filter(
        (offer) => offer.listing.currency === offers[0]?.listing.currency,
      )
      return { product, offers: sameCurrency }
    })
    .filter((entry) => entry.offers.length >= 2)
    .sort((left, right) => right.offers.length - left.offers.length)[0]
  if (!comparable) return null

  const cheapest = comparable.offers[0]
  const next = comparable.offers[1]
  const savings = Math.max(0, landedPrice(next.listing) - landedPrice(cheapest.listing))
  return (
    <a
      href={cheapest.listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-4 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-4 transition-colors hover:border-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-accent/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent-strong">
            Verified same-product deal
          </span>
          {savings > 0 && <span className="font-mono text-[10px] text-success">save {formatPrice(savings, cheapest.listing.currency)}</span>}
        </div>
        <p className="truncate text-sm font-semibold text-fg">{comparable.product.candidate.title}</p>
        <p className="mt-1 text-[11px] text-fg-muted">Compared across {comparable.offers.length} matching store offers</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-2xl font-bold text-accent-strong">{formatPrice(landedPrice(cheapest.listing), cheapest.listing.currency)}</p>
        <p className="text-[10px] text-fg-subtle">at {cheapest.adapter.label} →</p>
      </div>
    </a>
  )
}

function ProductCard({
  product,
  query,
  searchRunId,
}: {
  product: SearchProduct
  query: string
  searchRunId: string | null
}) {
  const offer = bestOffer(product)
  const listing = offer.listing
  const dot = TYPE_DOT[offer.adapter.type] ?? TYPE_DOT.mock
  const explanations = [
    offer.role === 'exact' ? 'exact match' : 'close substitute',
    ...offer.roleDecision.reasons.slice(0, 2),
    ...product.score.newlyCoveredAspects
      .filter((aspect) => aspect.startsWith('facet:'))
      .slice(0, 2)
      .map((aspect) => aspect.slice('facet:'.length)),
  ]
  const uniqueExplanations = [...new Set(explanations)]

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-bg-hover">
      <a href={listing.url} target="_blank" rel="noopener noreferrer" className="relative aspect-[4/3] overflow-hidden bg-bg-elevated">
        {listing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.imageUrl} alt={listing.title} loading="lazy" className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-wider text-fg-subtle">no image</div>
        )}
        <span className="absolute right-2 top-2 rounded-md bg-bg/90 px-2 py-1 font-mono text-[12px] font-bold text-accent-strong backdrop-blur-md">
          {listing.priceMinor > 0 ? formatPrice(landedPrice(listing), listing.currency) : 'Price unavailable'}
        </span>
        <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-bg/90 px-2 py-1 text-[10px] text-fg backdrop-blur-md">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {offer.adapter.label}
        </span>
      </a>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <a href={listing.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-tight text-fg hover:text-accent-strong">
          {product.candidate.title}
        </a>
        <div className="flex flex-wrap gap-1">
          {uniqueExplanations.slice(0, 3).map((reason) => (
            <span key={reason} className="rounded bg-bg-elevated px-1.5 py-1 text-[9px] text-fg-muted">{reason}</span>
          ))}
        </div>
        {product.offers.length > 1 && (
          <div className="border-t border-border pt-2 text-[10px] text-fg-muted">
            {product.offers.length} verified offers from {product.sourceKeys.length} stores
          </div>
        )}
        <div className="mt-auto border-t border-border pt-2">
          <SearchFeedback query={query} searchRunId={searchRunId} resultKey={product.entityKey} />
        </div>
      </div>
    </article>
  )
}

export function AllResultsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-20 animate-pulse rounded-xl border border-border bg-bg-card" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="aspect-[3/4] animate-pulse rounded-xl border border-border bg-bg-card" />
        ))}
      </div>
    </div>
  )
}
