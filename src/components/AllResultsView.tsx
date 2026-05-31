import { after } from 'next/server'
import type { Adapter, NormalizedListing } from '@/lib/adapters/types'
import { persistListings, recordAdapterError } from '@/lib/persist'
import { rankByRelevance, type RankedListing } from '@/lib/relevance'
import { parseQuery } from '@/lib/llm/query-parser'
import { formatPrice } from '@/lib/format'
import { ListingCard } from './ListingCard'
import type { SortKey } from './SearchToolbar'

type TaggedListing = RankedListing & { adapter: Adapter }

export async function AllResultsView({
  query,
  sort,
  adapters,
  timeoutMs,
}: {
  query: string
  sort: SortKey
  adapters: Adapter[]
  timeoutMs: number
}) {
  const parsed = await parseQuery(query)
  const searchQuery = parsed.refinedQuery || query

  // Fan out in parallel. Persistence is awaited inline (not via after()) so
  // ClusteredProductsSection's DB poll can see these writes.
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const raw = await adapter.search(searchQuery, AbortSignal.timeout(timeoutMs))
        const ranked = await rankByRelevance(query, raw, parsed)
        // Persist synchronously so ClusteredProductsSection (parallel Suspense
        // boundary, polls the DB) can see these listings before the response
        // is flushed.
        try {
          await persistListings(
            adapter.id,
            ranked.kept.map((r) => r.listing),
            ranked.kept.map((r) => r.embedding),
          )
        } catch (err) {
          console.error(`[persist] ${adapter.label}:`, err)
        }
        return { adapter, kept: ranked.kept }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        after(() => recordAdapterError(adapter.id, msg).catch(() => {}))
        return { adapter, kept: [] as RankedListing[] }
      }
    }),
  )

  const all: TaggedListing[] = results.flatMap(({ adapter, kept }) =>
    kept.map((k) => ({ ...k, adapter })),
  )

  if (sort === 'price-asc') {
    all.sort((a, b) => {
      const ap = a.listing.priceMinor || Number.MAX_SAFE_INTEGER
      const bp = b.listing.priceMinor || Number.MAX_SAFE_INTEGER
      return ap - bp
    })
  } else if (sort === 'price-desc') {
    all.sort((a, b) => (b.listing.priceMinor || 0) - (a.listing.priceMinor || 0))
  } else {
    all.sort((a, b) => b.score - a.score)
  }

  if (all.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-bg-card p-16 text-center">
        <p className="text-sm text-fg-muted">No matches across the selected sources.</p>
        <p className="font-mono text-[11px] text-fg-subtle">try different keywords or enable more sources</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <BestDealCallout listings={all} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {all.map(({ listing, adapter }) => (
          <ListingCard
            key={`${adapter.id}-${listing.externalId}`}
            listing={listing}
            retailerLabel={adapter.label}
            retailerType={adapter.type}
            showRetailerBadge
          />
        ))}
      </div>
    </div>
  )
}

function BestDealCallout({ listings }: { listings: TaggedListing[] }) {
  // Pick cheapest among the top-relevant pool, not absolute cheapest of
  // everything. Otherwise a low-scoring $3 accessory wins "lowest price".
  const priced = listings.filter((l) => l.listing.priceMinor > 0)
  if (priced.length === 0) return null
  const topRelevant = [...priced].sort((a, b) => b.score - a.score).slice(0, 10)
  // Require the top item to actually be a confident match — otherwise hide
  // the callout entirely rather than crowning a marginal result.
  if (topRelevant[0].score < 0.4) return null

  const cheapest = [...topRelevant].sort(
    (a, b) => a.listing.priceMinor - b.listing.priceMinor,
  )[0]

  const others = topRelevant.filter((l) => l !== cheapest).slice(0, 5)
  const median =
    others.length > 0
      ? others.map((l) => l.listing.priceMinor).sort((a, b) => a - b)[Math.floor(others.length / 2)]
      : 0
  const savings = median > 0 ? Math.round(((median - cheapest.listing.priceMinor) / median) * 100) : 0

  return (
    <a
      href={cheapest.listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent transition-all hover:border-accent hover:from-accent/15"
    >
      <div className="flex items-center gap-4 p-4">
        <div className="hidden h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-bg-elevated sm:block">
          {cheapest.listing.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cheapest.listing.imageUrl}
              alt={cheapest.listing.title}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-accent/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent-strong">
              ⚡ Lowest Price
            </span>
            {savings > 0 && (
              <span className="font-mono text-[10px] text-success">
                {savings}% below median
              </span>
            )}
          </div>
          <div className="truncate text-sm font-semibold text-fg">
            {cheapest.listing.title}
          </div>
          <div className="text-[11px] text-fg-muted">
            from <span className="font-medium text-fg">{cheapest.adapter.label}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="font-mono text-3xl font-bold leading-none text-accent-strong">
            {formatPrice(cheapest.listing.priceMinor, cheapest.listing.currency)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle group-hover:text-accent">
            open →
          </div>
        </div>
      </div>
    </a>
  )
}

export function AllResultsLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="h-24 animate-pulse rounded-2xl border border-accent/20 bg-accent/5" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] animate-pulse rounded-xl border border-border bg-bg-card"
          />
        ))}
      </div>
    </div>
  )
}
