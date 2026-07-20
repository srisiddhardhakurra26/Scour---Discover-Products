import type { Adapter } from '@/lib/adapters/types'
import { CATALOG_DUMP_TYPES, type RankedListing } from '@/lib/relevance'
import { searchAllAdapters } from '@/lib/fanout'
import { parseQuery } from '@/lib/llm/query-parser'
import { hasAttributeEvidence, rerankCandidates } from '@/lib/llm/rerank'
import { formatPrice } from '@/lib/format'

// LLM rerank score below which a candidate is judged off-intent and dropped.
const RERANK_KEEP = 0.45
// When the judge drops every candidate, show embedding matches at or above
// this score instead of an empty page (~0.35 = same product category).
const EMPTY_JUDGE_FALLBACK_FLOOR = 0.35
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

  // Shared fan-out: search + rank + persist happen once per adapter per
  // request (see fanout.ts); other sections await the same promises.
  const results = await searchAllAdapters(adapters, query, timeoutMs)

  const pool: TaggedListing[] = results.flatMap(({ adapter, kept }) =>
    kept.map((k) => ({ ...k, adapter })),
  )

  // Precision pass: an LLM reranks the candidate pool by true intent — a
  // Chelsea boot matches "shoes"; a sneaker does NOT match "leather boots".
  // Embeddings gave recall (and, with catalog-dump Shopify sources, a long
  // low-relevance tail — a sneaker brand's whole catalog for a "boots" query).
  // Cap to the strongest candidates, judge exactly that displayed set, and cut
  // the tail. Time-boxed inside rerankCandidates; on failure we fall back to
  // embedding order (still capped).
  // Cap the set the judge scores in one shot. A reasoning model rates ~40 short
  // titles far more reliably than 60 — fewer omissions, sharper per-item calls.
  const DISPLAY_CAP = 40
  let all = [...pool].sort((a, b) => b.score - a.score).slice(0, DISPLAY_CAP)
  if (all.length > 1) {
    const scores = await rerankCandidates(
      query,
      parsed,
      all.map((t) => ({
        id: `${t.adapter.id}-${t.listing.externalId}`,
        title: t.listing.title,
        brand: t.listing.sellerName,
        priceMinor: t.listing.priceMinor,
        currency: t.listing.currency,
        details: t.listing.detailsText,
      })),
    )
    if (scores) {
      const judged = all.flatMap((t) => {
        const s = scores.get(`${t.adapter.id}-${t.listing.externalId}`)
        if (s === undefined) return [t] // judge didn't score it → keep, don't guess
        if (s < RERANK_KEEP) return [] // judged off-intent → drop
        return [{ ...t, score: s }] // judged relevant → adopt the sharper score
      })
      // Judge rejected EVERYTHING. Respect rejections backed by evidence
      // (details said wool/canvas, shopper wants leather — hiding those is
      // CORRECT), and resurrect only evidence-blind candidates (title-only
      // sources like generic-html) in the confident embedding band. Without
      // the evidence check this showed Allbirds wool for "leather shoes".
      all =
        judged.length > 0
          ? judged
          : all.filter(
              (t) =>
                !hasAttributeEvidence(t.listing.detailsText) &&
                t.score >= EMPTY_JUDGE_FALLBACK_FLOOR,
            )
    } else {
      // Judge unavailable (rate limit/outage). Marketplace items already
      // matched the query server-side — keep them in embedding order (the
      // tuned LLM-down behavior). Catalog-dump items did NOT (the store
      // ignored the query), so raw embedding order shows the catalog's tail;
      // keep only the confident same-category band for those.
      all = all.filter(
        (t) =>
          !CATALOG_DUMP_TYPES.has(t.adapter.type) ||
          t.score >= EMPTY_JUDGE_FALLBACK_FLOOR,
      )
    }
  }

  if (sort === 'price-asc') {
    const currencyOrder = new Map(
      [...new Set(all.map((item) => item.listing.currency))].map((currency, index) => [
        currency,
        index,
      ]),
    )
    all.sort((a, b) => {
      const currencyDiff =
        (currencyOrder.get(a.listing.currency) ?? 0) -
        (currencyOrder.get(b.listing.currency) ?? 0)
      if (currencyDiff !== 0) return currencyDiff
      const ap = a.listing.priceMinor || Number.MAX_SAFE_INTEGER
      const bp = b.listing.priceMinor || Number.MAX_SAFE_INTEGER
      return ap - bp
    })
  } else if (sort === 'price-desc') {
    const currencyOrder = new Map(
      [...new Set(all.map((item) => item.listing.currency))].map((currency, index) => [
        currency,
        index,
      ]),
    )
    all.sort((a, b) => {
      const currencyDiff =
        (currencyOrder.get(a.listing.currency) ?? 0) -
        (currencyOrder.get(b.listing.currency) ?? 0)
      if (currencyDiff !== 0) return currencyDiff
      if (a.listing.priceMinor <= 0 && b.listing.priceMinor <= 0) return 0
      if (a.listing.priceMinor <= 0) return 1
      if (b.listing.priceMinor <= 0) return -1
      return b.listing.priceMinor - a.listing.priceMinor
    })
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

  const byCurrency = new Map<string, TaggedListing[]>()
  for (const listing of topRelevant) {
    const group = byCurrency.get(listing.listing.currency) ?? []
    group.push(listing)
    byCurrency.set(listing.listing.currency, group)
  }
  const comparable = [...byCurrency.values()].sort((a, b) => b.length - a.length)[0]
  const cheapest = [...comparable].sort(
    (a, b) => a.listing.priceMinor - b.listing.priceMinor,
  )[0]

  const others = comparable.filter((l) => l !== cheapest).slice(0, 5)
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
