import type { Adapter } from '@/lib/adapters/types'
import { CATALOG_DUMP_TYPES, type RankedListing } from '@/lib/relevance'
import { searchAdapter } from '@/lib/fanout'
import { parseQuery } from '@/lib/llm/query-parser'
import { hasAttributeEvidence, rerankCandidates } from '@/lib/llm/rerank'
import { ListingCard } from './ListingCard'
import { CardRail } from './CardRail'

// Precision rerank for the by-source view — but ONLY for catalog-dump sources
// (Shopify/Woo return the whole catalog, query ignored), which otherwise show
// off-intent items here. Marketplace/feed adapters already matched the query
// server-side; judging their sections too burned ~10 LLM calls per page view,
// blowing the free-tier rate limit so EVERY section fell back to raw
// embedding order — whole catalogs and off-material items on the page.
const RERANK_KEEP = 0.45
const RERANK_DISPLAY_CAP = 40
// When the judge drops every candidate, show embedding matches at or above
// this score instead of an empty section (~0.35 = same product category).
const EMPTY_JUDGE_FALLBACK_FLOOR = 0.35

type SectionData = {
  kept: RankedListing[]
  dropped: number
  rawCount: number
  elapsedMs: number
  fromCache: boolean
}

// Rank + rerank for display in one source section. The actual fetch/persist
// runs through the shared per-request fan-out (fanout.ts), so this section,
// AllResultsView, and the clusters section all see the same adapter results.
async function loadAdapterSection(
  adapter: Adapter,
  query: string,
  timeoutMs: number,
): Promise<SectionData | null> {
  const result = await searchAdapter(adapter, query, timeoutMs)
  if (result.failed || result.kept.length === 0) return null

  const parsed = await parseQuery(query)

  // Precision pass before display: judge true intent and drop off-target
  // catalog items. Catalog-dump sources only — see RERANK_KEEP comment.
  let display = result.kept.slice(0, RERANK_DISPLAY_CAP)
  if (display.length > 1 && CATALOG_DUMP_TYPES.has(adapter.type)) {
    const scores = await rerankCandidates(
      query,
      parsed,
      display.map((r) => ({
        id: r.listing.externalId,
        title: r.listing.title,
        brand: r.listing.sellerName,
        priceMinor: r.listing.priceMinor,
        currency: r.listing.currency,
        details: r.listing.detailsText,
      })),
    )
    if (scores) {
      const judged = display
        .flatMap((r) => {
          const s = scores.get(r.listing.externalId)
          if (s === undefined) return [r]
          if (s < RERANK_KEEP) return []
          return [{ ...r, score: s }]
        })
        .sort((a, b) => b.score - a.score)
      // Judge rejected everything — resurrect only evidence-blind candidates
      // in the confident embedding band (see AllResultsView for rationale);
      // evidence-backed rejections stand and the section hides honestly.
      display =
        judged.length > 0
          ? judged
          : display.filter(
              (r) =>
                !hasAttributeEvidence(r.listing.detailsText) &&
                r.score >= EMPTY_JUDGE_FALLBACK_FLOOR,
            )
    } else {
      // Judge unavailable (rate limit/outage). A catalog dump shown in raw
      // embedding order is the whole store's tail; keep only the confident
      // same-category band until the judge is back.
      display = display.filter((r) => r.score >= EMPTY_JUDGE_FALLBACK_FLOOR)
    }
  }

  return {
    kept: display,
    dropped: result.rawCount - display.length,
    rawCount: result.rawCount,
    elapsedMs: result.elapsedMs,
    fromCache: result.fromCache,
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
    (data.dropped > 0
      ? `${data.kept.length} of ${data.rawCount} · ${data.elapsedMs}ms`
      : `${data.kept.length} result${data.kept.length === 1 ? '' : 's'} · ${data.elapsedMs}ms`) +
    (data.fromCache ? ' · cached' : '')

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
