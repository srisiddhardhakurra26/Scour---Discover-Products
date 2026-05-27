import { Suspense } from 'react'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { SearchBar } from '@/components/SearchBar'
import { Header } from '@/components/Header'
import { BrandMark } from '@/components/Brand'
import { FeaturedClusters } from '@/components/FeaturedClusters'
import { getAdapters } from '@/lib/adapters/registry'

const TYPE_BADGE: Record<string, string> = {
  shopify: 'bg-emerald-400/10 text-emerald-300',
  woocommerce: 'bg-violet-400/10 text-violet-300',
  reddit: 'bg-orange-400/10 text-orange-300',
  rss: 'bg-amber-400/10 text-amber-300',
  ebay: 'bg-blue-400/10 text-blue-300',
  etsy: 'bg-pink-400/10 text-pink-300',
  bestbuy: 'bg-yellow-400/10 text-yellow-300',
  mock: 'bg-fg-subtle/10 text-fg-muted',
}

const TRENDING = [
  'wireless earbuds',
  'mechanical keyboard',
  'cocoa powder',
  'oled tv',
  'french press',
  'running shoe',
  'hoodie',
]

export default async function Home() {
  const [retailers, listings, products, adapters] = await Promise.all([
    prisma.retailer.count({ where: { enabled: true } }),
    prisma.listing.count(),
    prisma.product.count(),
    getAdapters(),
  ])

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-6 py-12 sm:py-20">
        {/* Hero */}
        <section className="flex flex-col items-center gap-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <BrandMark className="h-12 w-12" />
            <h1 className="max-w-3xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              One search.
              <br />
              <span className="text-accent-strong">Every store.</span>
            </h1>
            <p className="max-w-xl text-balance text-base text-fg-muted sm:text-lg">
              Type what you want once — Scour fans out across Amazon, eBay, Etsy, Shopify
              storefronts, Reddit deal communities, and more.
            </p>
          </div>

          <div className="w-full max-w-2xl">
            <SearchBar size="lg" />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="text-fg-subtle">try</span>
            {TRENDING.map((q) => (
              <Link
                key={q}
                href={`/search?q=${encodeURIComponent(q)}`}
                className="rounded-full border border-border bg-bg-card px-3 py-1 text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                {q}
              </Link>
            ))}
          </div>
        </section>

        {/* Featured clusters — the actual "shopping happens here" rail */}
        <Suspense fallback={null}>
          <FeaturedClusters />
        </Suspense>

        {/* Stats */}
        <section className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          <Stat label="Sources enabled" value={retailers} />
          <Stat label="Listings tracked" value={listings} />
          <Stat label="Products clustered" value={products} />
        </section>

        {/* Sources */}
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg">
              Active sources
            </h2>
            <Link
              href="/sources"
              className="font-mono text-[11px] text-fg-muted underline-offset-4 hover:text-accent hover:underline"
            >
              manage →
            </Link>
          </div>
          <ul className="flex flex-wrap gap-2">
            {adapters.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm"
              >
                <span className="font-medium">{a.label}</span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TYPE_BADGE[a.type] ?? TYPE_BADGE.mock}`}
                >
                  {a.type}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 bg-bg-card p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-fg-subtle">
        {label}
      </div>
      <div className="font-mono text-3xl font-bold tabular-nums text-fg">
        {value.toLocaleString('en-US')}
      </div>
    </div>
  )
}
