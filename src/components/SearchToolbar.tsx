'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition } from 'react'

export type AdapterMeta = { id: string; label: string; type: string }
export type ViewMode = 'all' | 'by-source'
export type SortKey = 'relevance' | 'price-asc' | 'price-desc'

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

export function SearchToolbar({
  view,
  sort,
  enabledIds,
  adapters,
  total,
}: {
  view: ViewMode
  sort: SortKey
  enabledIds: Set<string> | null
  adapters: AdapterMeta[]
  total?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    })
  }

  function toggleSource(id: string) {
    const all = adapters.map((a) => a.id)
    const current = enabledIds ?? new Set(all)
    const isOn = current.has(id)
    const nextSet = new Set(current)
    if (isOn) nextSet.delete(id)
    else nextSet.add(id)
    if (nextSet.size === all.length) {
      update({ sources: null })
    } else {
      update({ sources: nextSet.size > 0 ? [...nextSet].join(',') : 'none' })
    }
  }

  const visibleSourceCount = enabledIds?.size ?? adapters.length

  return (
    <div
      className={`sticky top-14 z-20 -mx-6 border-b border-border bg-bg/85 px-6 py-3 backdrop-blur-xl transition-opacity ${pending ? 'opacity-70' : ''}`}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        {/* View toggle */}
        <div className="flex overflow-hidden rounded-md border border-border-strong text-xs">
          <ToggleBtn
            active={view === 'all'}
            onClick={() => update({ view: null })}
            label="All"
          />
          <ToggleBtn
            active={view === 'by-source'}
            onClick={() => update({ view: 'by-source' })}
            label="By source"
          />
        </div>

        {/* Sort dropdown */}
        <label className="relative inline-flex items-center">
          <select
            value={sort}
            onChange={(e) => update({ sort: e.target.value === 'relevance' ? null : e.target.value })}
            className="appearance-none rounded-md border border-border-strong bg-bg-card px-3 pr-8 py-1.5 text-xs font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-ring"
          >
            <option value="relevance">Sort: Relevance</option>
            <option value="price-asc">Sort: Price ↑</option>
            <option value="price-desc">Sort: Price ↓</option>
          </select>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="pointer-events-none absolute right-3 text-fg-subtle"
            aria-hidden
          >
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </label>

        {/* Status */}
        {total !== undefined && (
          <span className="ml-auto font-mono text-[11px] tabular-nums text-fg-subtle">
            {total} listing{total === 1 ? '' : 's'} · {visibleSourceCount}/{adapters.length} sources
          </span>
        )}
      </div>

      {/* Source filter chips — scrollable on overflow */}
      <div className="mx-auto mt-2 max-w-6xl">
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {adapters.map((a) => {
            const on = enabledIds ? enabledIds.has(a.id) : true
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleSource(a.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  on
                    ? 'border-accent/40 bg-accent/10 text-fg'
                    : 'border-border bg-bg-card text-fg-subtle hover:border-border-strong hover:text-fg-muted'
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${on ? TYPE_DOT[a.type] ?? TYPE_DOT.mock : 'bg-border-strong'}`}
                />
                {a.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ToggleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 font-medium transition-colors ${
        active
          ? 'bg-accent text-bg'
          : 'bg-bg-card text-fg-muted hover:bg-bg-hover hover:text-fg'
      }`}
    >
      {label}
    </button>
  )
}
