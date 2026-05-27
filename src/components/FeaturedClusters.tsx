import Link from 'next/link'
import { prisma } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import { CardRail } from './CardRail'

export async function FeaturedClusters() {
  const products = await prisma.product.findMany({
    where: { retailerCount: { gte: 2 } },
    include: {
      listings: {
        orderBy: { priceMinor: 'asc' },
        include: { retailer: { select: { label: true, type: true } } },
      },
    },
    orderBy: [{ retailerCount: 'desc' }, { listingCount: 'desc' }],
    take: 10,
  })

  if (products.length === 0) return null

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-accent/30 pb-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-accent-strong">
            Trending clusters
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent/80">
            cross-source
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
          {products.length} product{products.length === 1 ? '' : 's'}
        </span>
      </div>

      <CardRail itemMinWidth={240} scrollByCount={3}>
        {products.map((p) => {
          const cheapest = p.listings[0]
          // Dedupe retailers for the chip preview
          const retailers = new Set<string>()
          for (const l of p.listings) retailers.add(l.retailer.label ?? l.retailer.type)
          const sample = [...retailers].slice(0, 3)
          const more = retailers.size - sample.length

          return (
            <Link
              key={p.id}
              href={`/search?q=${encodeURIComponent(p.canonicalTitle.split(/[,(]/)[0].slice(0, 60))}`}
              className="group flex w-[240px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-all hover:-translate-y-0.5 hover:border-accent/50"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-bg-elevated">
                {p.canonicalImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.canonicalImage}
                    alt={p.canonicalTitle}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-fg-subtle">
                    no image
                  </div>
                )}
                <div className="absolute right-2 top-2 rounded-md bg-bg/85 px-2 py-1 font-mono text-[11px] font-bold text-accent-strong backdrop-blur-md">
                  from {cheapest ? formatPrice(cheapest.priceMinor, cheapest.currency) : '—'}
                </div>
                <div className="absolute left-2 top-2 rounded-md bg-bg/85 px-1.5 py-0.5 font-mono text-[10px] font-bold text-fg backdrop-blur-md">
                  {p.retailerCount} stores
                </div>
              </div>
              <div className="flex flex-col gap-1.5 p-3">
                <div className="line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-tight text-fg">
                  {p.canonicalTitle}
                </div>
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-fg-subtle">
                  {sample.map((label) => (
                    <span
                      key={label}
                      className="rounded border border-border bg-bg-elevated px-1.5 py-[1px]"
                    >
                      {label}
                    </span>
                  ))}
                  {more > 0 && <span className="font-mono">+{more}</span>}
                </div>
              </div>
            </Link>
          )
        })}
      </CardRail>
    </section>
  )
}
