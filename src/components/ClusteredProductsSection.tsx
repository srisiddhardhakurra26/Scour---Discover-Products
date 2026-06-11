import { prisma } from '@/lib/db'
import type { Adapter } from '@/lib/adapters/types'
import { formatPrice } from '@/lib/format'
import { bytesToFloat, dotProduct, embedQueryCached, EMBEDDING_DIM } from '@/lib/embeddings'
import { searchAllAdapters } from '@/lib/fanout'
import { parseQuery } from '@/lib/llm/query-parser'
import { rerankCandidates } from '@/lib/llm/rerank'
import { clusterHasTokenOverlap } from '@/lib/text'
import { minPriceTrend } from '@/lib/price-history'
import { Sparkline } from './Sparkline'
import { SaveButton } from './SaveButton'
import { CommunityIntel } from './CommunityIntel'
import { CardRail } from './CardRail'

// Clusters whose best listing scores below this against the query are dropped.
// Lower than the per-listing floor: a cluster having multiple retailers is
// already a quality signal, so we can be a bit more permissive on relevance.
const CLUSTER_RELEVANCE_FLOOR = 0.25

export function ClusteredProductsLoading() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-accent/40 pb-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-accent-strong">
            Products
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent/80">
            clustering…
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
          comparing across retailers
        </span>
      </div>
      <div className="flex gap-3 overflow-hidden pb-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex h-[152px] w-[360px] shrink-0 animate-pulse gap-3 rounded-xl border border-border bg-bg-card p-3"
          >
            <div className="h-24 w-24 shrink-0 rounded-lg bg-bg-elevated" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-3 w-3/4 rounded bg-bg-elevated" />
              <div className="h-3 w-1/2 rounded bg-bg-elevated" />
              <div className="mt-1 flex flex-col gap-1.5">
                <div className="h-2 w-full rounded bg-bg-elevated/70" />
                <div className="h-2 w-full rounded bg-bg-elevated/70" />
                <div className="h-2 w-2/3 rounded bg-bg-elevated/70" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function fetchClusterCandidates() {
  return prisma.product.findMany({
    where: { retailerCount: { gte: 2 } },
    include: {
      listings: {
        include: {
          retailer: { select: { label: true, type: true } },
          prices: {
            orderBy: { capturedAt: 'asc' },
            select: { priceMinor: true, capturedAt: true },
            take: 30,
          },
        },
        orderBy: { priceMinor: 'asc' },
      },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 200,
  })
}

type Candidate = Awaited<ReturnType<typeof fetchClusterCandidates>>[number]

function rankForQuery(
  products: Candidate[],
  matchQuery: string,
  queryVec: Float32Array,
  parsed: Awaited<ReturnType<typeof parseQuery>>,
): Candidate[] {
  return products
    .map((p) => {
      let best = 0
      for (const l of p.listings) {
        if (!l.textEmbedding) continue
        const v = bytesToFloat(l.textEmbedding)
        if (v.length !== EMBEDDING_DIM) continue
        const s = dotProduct(queryVec, v)
        if (s > best) best = s
      }
      return { product: p, score: best }
    })
    .filter((r) => {
      if (r.score < CLUSTER_RELEVANCE_FLOOR) return false
      const titles = [r.product.canonicalTitle, ...r.product.listings.map((l) => l.title)]
      if (!clusterHasTokenOverlap(matchQuery, titles)) return false
      if (parsed.maxPriceMinor !== undefined || parsed.minPriceMinor !== undefined) {
        const priced = r.product.listings.filter((l) => l.priceMinor > 0)
        if (priced.length > 0) {
          const anyInside = priced.some((l) => {
            if (parsed.maxPriceMinor !== undefined && l.priceMinor > parsed.maxPriceMinor) return false
            if (parsed.minPriceMinor !== undefined && l.priceMinor < parsed.minPriceMinor) return false
            return true
          })
          if (!anyInside) return false
        }
      }
      return true
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.product)
}

export async function ClusteredProductsSection({
  query,
  adapters,
  timeoutMs,
}: {
  query: string
  adapters: Adapter[]
  timeoutMs: number
}) {
  const parsed = query.trim() ? await parseQuery(query) : null
  const matchQuery = parsed?.refinedQuery || query
  const queryVec = parsed ? await embedQueryCached(matchQuery) : null

  // Await the shared fan-out (deduped per request, see fanout.ts) so every
  // adapter's listings are persisted and clustered before we read. This
  // replaces the old DB poll, which raced the writes and could surface a
  // partial — and run-to-run different — set of clusters.
  await searchAllAdapters(adapters, query, timeoutMs)

  const candidates = await fetchClusterCandidates()
  if (candidates.length === 0) return null
  const ranked =
    queryVec && parsed ? rankForQuery(candidates, matchQuery, queryVec, parsed) : candidates
  const visible = ranked.slice(0, 12)
  if (visible.length === 0) return null

  // Precision rerank of the clustered products by true intent (see rerank.ts).
  // Falls back to embedding order if the judge is unavailable.
  let products = visible
  if (parsed && visible.length > 1) {
    const scores = await rerankCandidates(
      query,
      parsed,
      visible.map((p) => ({
        id: p.id,
        title: p.canonicalTitle,
        brand: p.brand,
        priceMinor: p.listings[0]?.priceMinor,
        currency: p.listings[0]?.currency,
      })),
    )
    if (scores) {
      products = visible
        .map((p) => ({ p, s: scores.get(p.id) }))
        .filter(({ s }) => s === undefined || s >= 0.45)
        .sort((a, b) => (b.s ?? 0) - (a.s ?? 0))
        .map(({ p }) => p)
    }
  }
  if (products.length === 0) return null

  const totalListings = products.reduce((acc, p) => acc + p.listings.length, 0)

  // Which of these are already on the wishlist, so the heart renders filled.
  const savedRows = await prisma.savedProduct.findMany({
    where: { productId: { in: products.map((p) => p.id) } },
    select: { productId: true },
  })
  const savedSet = new Set(savedRows.map((r) => r.productId))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-accent/40 pb-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-accent-strong">
            Products
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent/80">
            clustered
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
          {products.length} cluster{products.length === 1 ? '' : 's'} · {totalListings} listings
        </span>
      </div>
      <CardRail itemMinWidth={360} scrollByCount={2}>
        {products.map((p) => (
          <div key={p.id} className="w-[360px] shrink-0 snap-start">
            <ProductCard product={p} saved={savedSet.has(p.id)} />
          </div>
        ))}
      </CardRail>
    </section>
  )
}

type ProductRow = {
  id: string
  canonicalTitle: string
  canonicalImage: string | null
  listings: Array<{
    id: string
    url: string
    priceMinor: number
    currency: string
    sellerName: string | null
    retailer: { label: string | null; type: string }
    prices: Array<{ priceMinor: number; capturedAt: Date }>
  }>
}

function ProductCard({ product, saved }: { product: ProductRow; saved: boolean }) {
  // Dedupe by retailer: keep cheapest listing per retailer.
  // "One from r/buildapcsales is enough." Same applies to Slickdeals, Allbirds, etc.
  const dedupedMap = new Map<string, ProductRow['listings'][number]>()
  const sortedByPrice = [...product.listings].sort((a, b) => a.priceMinor - b.priceMinor)
  for (const l of sortedByPrice) {
    const key = (l.retailer.label ?? l.retailer.type).toLowerCase()
    if (!dedupedMap.has(key)) dedupedMap.set(key, l)
  }
  const deduped = [...dedupedMap.values()]
  const hiddenCount = product.listings.length - deduped.length

  const lowest = deduped[0]
  const highest = deduped[deduped.length - 1]
  const spread =
    deduped.length > 1 && highest.priceMinor > 0
      ? Math.round(((highest.priceMinor - lowest.priceMinor) / highest.priceMinor) * 100)
      : 0

  // Aggregated lowest-price-over-time across all listings (see price-history.ts).
  const trend = minPriceTrend(product.listings).map((p) => p.priceMinor)

  const visibleListings = deduped.slice(0, 4)
  const overflow = hiddenCount + Math.max(0, deduped.length - visibleListings.length)

  return (
    <div className="group relative flex gap-3 rounded-xl border border-border bg-bg-card p-3 transition-colors hover:border-border-strong">
      <a
        href={lowest.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-bg-elevated transition-transform hover:scale-[1.02]"
        aria-label={`Open cheapest listing for ${product.canonicalTitle}`}
      >
        {product.canonicalImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.canonicalImage}
            alt={product.canonicalTitle}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-fg-subtle">
            no image
          </div>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <a
            href={lowest.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-[13px] font-medium leading-tight text-fg hover:text-accent-strong"
          >
            {product.canonicalTitle}
          </a>
          <div className="flex shrink-0 items-center gap-1.5">
            {spread > 0 && (
              <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent-strong">
                –{spread}%
              </span>
            )}
            <SaveButton productId={product.id} initialSaved={saved} />
          </div>
        </div>

        <ul className="flex flex-col">
          {visibleListings.map((l, i) => (
            <li key={l.id}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-baseline justify-between gap-2 border-t border-border/50 py-1.5 text-[11px] transition-colors first:border-t-0 first:pt-0 hover:bg-bg-hover/50 -mx-1 px-1 rounded"
              >
                <span className="flex items-baseline gap-1.5 truncate text-fg-muted">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-subtle" />
                  <span className="truncate">{l.retailer.label ?? l.retailer.type}</span>
                </span>
                <span
                  className={`shrink-0 font-mono font-bold tabular-nums ${i === 0 ? 'text-accent-strong' : 'text-fg-muted'}`}
                >
                  {formatPrice(l.priceMinor, l.currency)}
                </span>
              </a>
            </li>
          ))}
          {overflow > 0 && (
            <li className="border-t border-border/50 pt-1 font-mono text-[10px] text-fg-subtle">
              +{overflow} more
            </li>
          )}
        </ul>

        {trend.length > 1 && (
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
              {trend.length}d trend
            </span>
            <Sparkline values={trend} width={70} height={18} />
          </div>
        )}

        <CommunityIntel productTitle={product.canonicalTitle} />
      </div>
    </div>
  )
}
