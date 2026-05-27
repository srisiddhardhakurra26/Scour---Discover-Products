import { prisma } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import { Sparkline } from './Sparkline'

export async function ClusteredProductsSection({ query }: { query: string }) {
  const products = await prisma.product.findMany({
    where: {
      retailerCount: { gte: 2 },
      ...(query ? { listings: { some: { title: { contains: query } } } } : {}),
    },
    include: {
      listings: {
        include: {
          retailer: { select: { label: true, type: true } },
          prices: {
            orderBy: { capturedAt: 'asc' },
            select: { priceMinor: true, capturedAt: true },
            take: 30,
          },
        },
        orderBy: { priceMinor: 'asc' },
      },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 12,
  })

  if (products.length === 0) return null

  const totalListings = products.reduce((acc, p) => acc + p.listings.length, 0)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-accent/40 pb-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-accent-strong">
            Products
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent/80">
            clustered
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
          {products.length} cluster{products.length === 1 ? '' : 's'} · {totalListings} listings
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  )
}

type ProductRow = {
  id: string
  canonicalTitle: string
  canonicalImage: string | null
  listings: Array<{
    id: string
    url: string
    priceMinor: number
    currency: string
    sellerName: string | null
    retailer: { label: string | null; type: string }
    prices: Array<{ priceMinor: number; capturedAt: Date }>
  }>
}

function ProductCard({ product }: { product: ProductRow }) {
  // Dedupe by retailer: keep cheapest listing per retailer.
  // "One from r/buildapcsales is enough." Same applies to Slickdeals, Allbirds, etc.
  const dedupedMap = new Map<string, ProductRow['listings'][number]>()
  const sortedByPrice = [...product.listings].sort((a, b) => a.priceMinor - b.priceMinor)
  for (const l of sortedByPrice) {
    const key = (l.retailer.label ?? l.retailer.type).toLowerCase()
    if (!dedupedMap.has(key)) dedupedMap.set(key, l)
  }
  const deduped = [...dedupedMap.values()]
  const hiddenCount = product.listings.length - deduped.length

  const lowest = deduped[0]
  const highest = deduped[deduped.length - 1]
  const spread =
    deduped.length > 1 && highest.priceMinor > 0
      ? Math.round(((highest.priceMinor - lowest.priceMinor) / highest.priceMinor) * 100)
      : 0

  // Build aggregated min-price-over-time across all listings
  const minByTime = new Map<number, number>()
  for (const l of product.listings) {
    for (const obs of l.prices) {
      const bucket = Math.floor(obs.capturedAt.getTime() / (1000 * 60 * 60)) * (1000 * 60 * 60)
      const cur = minByTime.get(bucket)
      if (cur === undefined || obs.priceMinor < cur) minByTime.set(bucket, obs.priceMinor)
    }
  }
  const trend = [...minByTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)

  const visibleListings = deduped.slice(0, 4)
  const overflow = hiddenCount + Math.max(0, deduped.length - visibleListings.length)

  return (
    <div className="group relative flex gap-3 rounded-xl border border-border bg-bg-card p-3 transition-colors hover:border-border-strong">
      <a
        href={lowest.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-bg-elevated transition-transform hover:scale-[1.02]"
        aria-label={`Open cheapest listing for ${product.canonicalTitle}`}
      >
        {product.canonicalImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.canonicalImage}
            alt={product.canonicalTitle}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-fg-subtle">
            no image
          </div>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <a
            href={lowest.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-[13px] font-medium leading-tight text-fg hover:text-accent-strong"
          >
            {product.canonicalTitle}
          </a>
          {spread > 0 && (
            <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent-strong">
              –{spread}%
            </span>
          )}
        </div>

        <ul className="flex flex-col">
          {visibleListings.map((l, i) => (
            <li key={l.id}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-baseline justify-between gap-2 border-t border-border/50 py-1.5 text-[11px] transition-colors first:border-t-0 first:pt-0 hover:bg-bg-hover/50 -mx-1 px-1 rounded"
              >
                <span className="flex items-baseline gap-1.5 truncate text-fg-muted">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-subtle" />
                  <span className="truncate">{l.retailer.label ?? l.retailer.type}</span>
                </span>
                <span
                  className={`shrink-0 font-mono font-bold tabular-nums ${i === 0 ? 'text-accent-strong' : 'text-fg-muted'}`}
                >
                  {formatPrice(l.priceMinor, l.currency)}
                </span>
              </a>
            </li>
          ))}
          {overflow > 0 && (
            <li className="border-t border-border/50 pt-1 font-mono text-[10px] text-fg-subtle">
              +{overflow} more
            </li>
          )}
        </ul>

        {trend.length > 1 && (
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
              {trend.length}d trend
            </span>
            <Sparkline values={trend} width={70} height={18} />
          </div>
        )}
      </div>
    </div>
  )
}
