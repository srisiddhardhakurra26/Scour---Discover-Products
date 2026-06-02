import { prisma } from '@/lib/db'
import { Header } from '@/components/Header'
import { timeAgo } from '@/lib/format'
import { AddSourceForm } from './AddSourceForm'
import { RetailerRow } from './RetailerRow'

// Reads the DB at render time, so it can't be statically prerendered at build
// (there's no database during the image build). Render on each request.
export const dynamic = 'force-dynamic'

// Pull the search-URL template out of a generic-html config for an at-a-glance
// summary in the console. Best-effort: a corrupt config just shows nothing.
function configSummary(type: string, config: string | null): string | null {
  if (type !== 'generic-html' || !config) return null
  try {
    const c = JSON.parse(config) as { searchUrlTemplate?: string }
    return typeof c.searchUrlTemplate === 'string' ? c.searchUrlTemplate : null
  } catch {
    return null
  }
}

const TYPE_ORDER = [
  'shopify',
  'woocommerce',
  'generic-html',
  'reddit',
  'rss',
  'ebay',
  'etsy',
  'bestbuy',
  'amazon',
  'mock',
]

const TYPE_LABEL: Record<string, string> = {
  shopify: 'Shopify storefronts',
  woocommerce: 'WooCommerce storefronts',
  'generic-html': 'Agent-onboarded storefronts',
  reddit: 'Reddit communities',
  rss: 'RSS feeds',
  ebay: 'eBay',
  etsy: 'Etsy',
  bestbuy: 'Best Buy',
  amazon: 'Amazon',
  mock: 'Mock sources (testing)',
}

export default async function SourcesPage() {
  const retailers = await prisma.retailer.findMany({
    orderBy: { label: 'asc' },
  })

  const byType = new Map<string, typeof retailers>()
  for (const r of retailers) {
    if (!byType.has(r.type)) byType.set(r.type, [])
    byType.get(r.type)!.push(r)
  }

  const orderedTypes = [
    ...TYPE_ORDER.filter((t) => byType.has(t)),
    ...Array.from(byType.keys()).filter((t) => !TYPE_ORDER.includes(t)),
  ]

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Sources</h1>
          <p className="text-sm text-fg-muted">
            Enable, disable, or add storefronts. Built-in sources can&apos;t be removed —
            only toggled.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-muted">
            Add a storefront
          </h2>
          <AddSourceForm />
        </section>

        <section className="flex flex-col gap-7">
          {orderedTypes.map((type) => {
            const rows = byType.get(type) ?? []
            const enabledCount = rows.filter((r) => r.enabled).length
            return (
              <div key={type} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-muted">
                    {TYPE_LABEL[type] ?? type}
                  </h2>
                  <span className="font-mono text-[10px] tabular-nums text-fg-subtle">
                    {enabledCount}/{rows.length} on
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {rows.map((r) => (
                    <RetailerRow
                      key={r.id}
                      id={r.id}
                      type={r.type}
                      label={r.label ?? r.identifier}
                      identifier={r.identifier}
                      enabled={r.enabled}
                      lastFetchedLabel={r.lastFetchedAt ? timeAgo(r.lastFetchedAt) : null}
                      lastError={r.lastError}
                      configSummary={configSummary(r.type, r.config)}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      </main>
    </>
  )
}
