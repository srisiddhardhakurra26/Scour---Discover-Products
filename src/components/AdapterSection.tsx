import { after } from 'next/server'
import type { Adapter } from '@/lib/adapters/types'
import { persistListings, recordAdapterError } from '@/lib/persist'
import { rankByRelevance, recallModeForType, type RankedListing } from '@/lib/relevance'
import { parseQuery } from '@/lib/llm/query-parser'
import { withHardTimeout } from '@/lib/timeout'
import { ListingCard } from './ListingCard'
import { CardRail } from './CardRail'

type SectionData = {
  kept: RankedListing[]
  dropped: number
  rawCount: number
  elapsedMs: number
}

// Fetch + rank + persist for one adapter. A plain async helper (not a React
// component) so the timing clock and the error-handling try/catch live outside
// render — the component below just awaits this and renders. Returns null on
// adapter error or when there's nothing to show.
async function loadAdapterSection(
  adapter: Adapter,
  query: string,
  timeoutMs: number,
): Promise<SectionData | null> {
  const started = performance.now()
  try {
    const parsed = await parseQuery(query)
    const searchQuery = parsed.refinedQuery || query
    // Hard ceiling on top of the AbortSignal: some adapters don't honor abort
    // and would otherwise hang this section (and the parallel cluster poll).
    const rawListings = await withHardTimeout(
      adapter.search(searchQuery, AbortSignal.timeout(timeoutMs)),
      timeoutMs + 1500,
      `${adapter.label} search`,
    )
    if (rawListings.length === 0) return null

    const ranked = await rankByRelevance(query, rawListings, parsed, recallModeForType(adapter.type))

    // Persist synchronously (not via `after()`) so ClusteredProductsSection,
    // which renders in a parallel Suspense boundary and polls the DB, can see
    // these writes before the response is sent.
    try {
      await persistListings(
        adapter.id,
        ranked.kept.map((r) => r.listing),
        ranked.kept.map((r) => r.embedding),
      )
    } catch (err) {
      console.error(`[persist] ${adapter.label}:`, err)
    }

    return {
      kept: ranked.kept,
      dropped: ranked.dropped,
      rawCount: rawListings.length,
      elapsedMs: Math.round(performance.now() - started),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    after(() => recordAdapterError(adapter.id, message).catch(() => {}))
    console.error(`[adapter] ${adapter.label}: ${message}`)
    return null
  }
}

export async function AdapterSection({
  adapter,
  query,
  timeoutMs,
}: {
  adapter: Adapter
  query: string
  timeoutMs: number
}) {
  const data = await loadAdapterSection(adapter, query, timeoutMs)
  if (!data || data.kept.length === 0) return null

  const status =
    data.dropped > 0
      ? `${data.kept.length} of ${data.rawCount} · ${data.elapsedMs}ms`
      : `${data.kept.length} result${data.kept.length === 1 ? '' : 's'} · ${data.elapsedMs}ms`

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader label={adapter.label} type={adapter.type} status={status} />
      <CardRail itemMinWidth={210}>
        {data.kept.map(({ listing }) => (
          <div
            key={`${adapter.id}-${listing.externalId}`}
            className="w-[210px] shrink-0 snap-start"
          >
            <ListingCard listing={listing} retailerLabel={adapter.label} />
          </div>
        ))}
      </CardRail>
    </section>
  )
}

export function AdapterLoading({ adapter }: { adapter: Adapter }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader label={adapter.label} type={adapter.type} status="searching…" />
      <div className="flex gap-3 overflow-hidden pb-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] w-[210px] shrink-0 animate-pulse rounded-xl border border-border bg-bg-card"
          />
        ))}
      </div>
    </section>
  )
}

const TYPE_COLORS: Record<string, string> = {
  shopify: 'text-emerald-300/80',
  woocommerce: 'text-violet-300/80',
  reddit: 'text-orange-300/80',
  rss: 'text-amber-300/80',
  ebay: 'text-blue-300/80',
  etsy: 'text-pink-300/80',
  bestbuy: 'text-yellow-300/80',
  amazon: 'text-orange-200/80',
  'generic-html': 'text-cyan-300/80',
  mock: 'text-fg-subtle',
}

function SectionHeader({
  label,
  type,
  status,
}: {
  label: string
  type: string
  status: string
}) {
  const typeColor = TYPE_COLORS[type] ?? 'text-fg-subtle'
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg">
          {label}
        </h2>
        <span className={`font-mono text-[10px] uppercase tracking-wider ${typeColor}`}>
          {type}
        </span>
      </div>
      <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
        {status}
      </span>
    </div>
  )
}
