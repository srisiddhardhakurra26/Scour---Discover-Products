import { Suspense } from 'react'
import { Header } from '@/components/Header'
import { SearchBar } from '@/components/SearchBar'
import { AdapterSection, AdapterLoading } from '@/components/AdapterSection'
import { ClusteredProductsSection } from '@/components/ClusteredProductsSection'
import { getAdapters, ADAPTER_TIMEOUT_MS } from '@/lib/adapters/registry'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = q?.trim() ?? ''
  const adapters = await getAdapters()

  return (
    <>
      <Header>
        <div className="hidden w-full max-w-xl md:block">
          <SearchBar size="sm" defaultValue={query} />
        </div>
      </Header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
        <div className="md:hidden">
          <SearchBar defaultValue={query} />
        </div>

        {query && (
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-fg-muted">
              Results for{' '}
              <span className="font-semibold text-fg">&ldquo;{query}&rdquo;</span>
            </p>
            <p className="font-mono text-[11px] text-fg-subtle">
              {adapters.length} source{adapters.length === 1 ? '' : 's'} · fan-out
            </p>
          </div>
        )}

        {!query ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-bg-card p-16 text-center">
            <p className="text-sm text-fg-muted">
              Type what you want above to scour every enabled store.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            <ClusteredProductsSection query={query} />
            {adapters.map((adapter) => (
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
      </main>
    </>
  )
}
