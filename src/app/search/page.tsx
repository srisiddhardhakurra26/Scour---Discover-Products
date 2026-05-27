import { Suspense } from 'react'
import { Header } from '@/components/Header'
import { SearchBar } from '@/components/SearchBar'
import { AdapterSection, AdapterLoading } from '@/components/AdapterSection'
import { ClusteredProductsSection } from '@/components/ClusteredProductsSection'
import { AllResultsView, AllResultsLoading } from '@/components/AllResultsView'
import { SearchToolbar, type SortKey, type ViewMode } from '@/components/SearchToolbar'
import { getAdapters, ADAPTER_TIMEOUT_MS } from '@/lib/adapters/registry'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; sort?: string; sources?: string }>
}) {
  const sp = await searchParams
  const query = (sp.q ?? '').trim()
  const view: ViewMode = sp.view === 'by-source' ? 'by-source' : 'all'
  const sort: SortKey =
    sp.sort === 'price-asc' || sp.sort === 'price-desc' ? sp.sort : 'relevance'

  const allAdapters = await getAdapters()
  const enabledIds =
    sp.sources && sp.sources.length > 0 ? new Set(sp.sources.split(',')) : null
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

      {query && (
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
        ) : (
          <div className="flex flex-col gap-10">
            <ClusteredProductsSection query={query} />

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
