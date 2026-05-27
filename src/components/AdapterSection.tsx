import { after } from 'next/server'
import type { Adapter } from '@/lib/adapters/types'
import { persistListings, recordAdapterError } from '@/lib/persist'
import { rankByRelevance } from '@/lib/relevance'
import { ListingCard } from './ListingCard'

export async function AdapterSection({
  adapter,
  query,
  timeoutMs,
}: {
  adapter: Adapter
  query: string
  timeoutMs: number
}) {
  const started = performance.now()
  try {
    const rawListings = await adapter.search(query, AbortSignal.timeout(timeoutMs))
    if (rawListings.length === 0) return null

    const ranked = await rankByRelevance(query, rawListings)
    const elapsedMs = Math.round(performance.now() - started)

    after(async () => {
      try {
        await persistListings(
          adapter.id,
          ranked.kept.map((r) => r.listing),
          ranked.kept.map((r) => r.embedding),
        )
      } catch (err) {
        console.error(`[persist] ${adapter.label}:`, err)
      }
    })

    if (ranked.kept.length === 0) return null

    const status =
      ranked.dropped > 0
        ? `${ranked.kept.length} of ${rawListings.length} · ${elapsedMs}ms`
        : `${ranked.kept.length} result${ranked.kept.length === 1 ? '' : 's'} · ${elapsedMs}ms`

    return (
      <section className="flex flex-col gap-4">
        <SectionHeader label={adapter.label} type={adapter.type} status={status} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ranked.kept.map(({ listing }) => (
            <ListingCard
              key={`${adapter.id}-${listing.externalId}`}
              listing={listing}
              retailerLabel={adapter.label}
            />
          ))}
        </div>
      </section>
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    after(() => recordAdapterError(adapter.id, message).catch(() => {}))
    console.error(`[adapter] ${adapter.label}: ${message}`)
    return null
  }
}

export function AdapterLoading({ adapter }: { adapter: Adapter }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader label={adapter.label} type={adapter.type} status="searching…" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] animate-pulse rounded-xl border border-border bg-bg-card"
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
