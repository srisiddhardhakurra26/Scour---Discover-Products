import { Suspense } from 'react'
import Link from 'next/link'
import { Header } from '@/components/Header'
import { SearchBar } from '@/components/SearchBar'
import { AdapterSection, AdapterLoading } from '@/components/AdapterSection'
import {
  ClusteredProductsSection,
  ClusteredProductsLoading,
} from '@/components/ClusteredProductsSection'
import { AllResultsView, AllResultsLoading } from '@/components/AllResultsView'
import { SearchToolbar, type SortKey, type ViewMode } from '@/components/SearchToolbar'
import {
  MissionSearchLoading,
  MissionSearchResults,
} from '@/components/MissionSearchResults'
import { getAdapters, ADAPTER_TIMEOUT_MS } from '@/lib/adapters/registry'
import { classifySearchIntent, type SearchIntent } from '@/lib/llm/search-intent'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    view?: string
    sort?: string
    sources?: string
    mode?: string
  }>
}) {
  const sp = await searchParams
  const query = (sp.q ?? '').trim().slice(0, 200)
  const view: ViewMode = sp.view === 'by-source' ? 'by-source' : 'all'
  const sort: SortKey =
    sp.sort === 'price-asc' || sp.sort === 'price-desc' ? sp.sort : 'relevance'
  const forcedIntent: SearchIntent | null =
    sp.mode === 'mission' ? 'mission' : sp.mode === 'product' ? 'product' : null
  const intentDecision = query
    ? forcedIntent
      ? { intent: forcedIntent, confidence: 1, reason: 'Selected by the user.' }
      : await classifySearchIntent(query)
    : { intent: 'product' as const, confidence: 1, reason: '' }
  const isMission = query.length > 0 && intentDecision.intent === 'mission'

  const allAdapters = isMission ? [] : await getAdapters()
  const enabledIds = sp.sources
    ? new Set(
        sp.sources
          .split(',')
          .filter((id) => allAdapters.some((adapter) => adapter.id === id)),
      )
    : null
  const activeAdapters = enabledIds
    ? allAdapters.filter((a) => enabledIds.has(a.id))
    : allAdapters

  return (
    <>
      <Header>
        <div className="hidden w-full max-w-xl md:block">
          <SearchBar size="sm" defaultValue={query} />
        </div>
      </Header>

      {query && !isMission && (
        <SearchToolbar
          view={view}
          sort={sort}
          enabledIds={enabledIds}
          adapters={allAdapters.map((a) => ({ id: a.id, label: a.label, type: a.type }))}
        />
      )}

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-6">
        <div className="md:hidden">
          <SearchBar defaultValue={query} />
        </div>

        {!query ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-bg-card p-16 text-center">
            <p className="text-sm text-fg-muted">
              Type what you want above to scour every enabled store.
            </p>
            <p className="font-mono text-[11px] text-fg-subtle">
              tip: press <kbd className="rounded border border-border bg-bg px-1 py-[1px]">⌘K</kbd> from anywhere
            </p>
          </div>
        ) : isMission ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-accent-strong">
                  Planning this as a multi-item shopping goal
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Scour will search each required category and combine the results.
                </p>
              </div>
              <Link
                href={`/search?q=${encodeURIComponent(query)}&mode=product`}
                className="rounded-lg border border-border-strong bg-bg px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
              >
                Search as one product
              </Link>
            </div>
            <Suspense fallback={<MissionSearchLoading />}>
              <MissionSearchResults query={query} />
            </Suspense>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <Suspense fallback={<ClusteredProductsLoading />}>
              <ClusteredProductsSection
                query={query}
                adapters={activeAdapters}
                timeoutMs={ADAPTER_TIMEOUT_MS}
              />
            </Suspense>

            {view === 'all' ? (
              <Suspense fallback={<AllResultsLoading />}>
                <AllResultsView
                  query={query}
                  sort={sort}
                  adapters={activeAdapters}
                  timeoutMs={ADAPTER_TIMEOUT_MS}
                />
              </Suspense>
            ) : (
              <div className="flex flex-col gap-12">
                {activeAdapters.map((adapter) => (
                  <Suspense key={adapter.id} fallback={<AdapterLoading adapter={adapter} />}>
                    <AdapterSection
                      adapter={adapter}
                      query={query}
                      timeoutMs={ADAPTER_TIMEOUT_MS}
                    />
                  </Suspense>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}
