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
  const lowest = product.listings[0]
  const highest = product.listings[product.listings.length - 1]
  const spread =
    product.listings.length > 1 && highest.priceMinor > 0
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

  return (
    <div className="group relative flex gap-3 rounded-xl border border-border bg-bg-card p-3 transition-colors hover:border-border-strong">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-bg-elevated">
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
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="line-clamp-2 text-[13px] font-medium leading-tight text-fg">
            {product.canonicalTitle}
          </div>
          {spread > 0 && (
            <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent-strong">
              –{spread}%
            </span>
          )}
        </div>

        <ul className="flex flex-col">
          {product.listings.slice(0, 4).map((l, i) => (
            <li
              key={l.id}
              className="flex items-baseline justify-between gap-2 border-t border-border/50 py-1 text-[11px] first:border-t-0 first:pt-0"
            >
              <span className="flex items-baseline gap-1.5 truncate text-fg-muted">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-subtle" />
                <span className="truncate">{l.retailer.label ?? l.retailer.type}</span>
              </span>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`shrink-0 font-mono font-bold tabular-nums hover:underline ${i === 0 ? 'text-accent-strong' : 'text-fg-muted'}`}
              >
                {formatPrice(l.priceMinor, l.currency)}
              </a>
            </li>
          ))}
          {product.listings.length > 4 && (
            <li className="border-t border-border/50 pt-1 font-mono text-[10px] text-fg-subtle">
              +{product.listings.length - 4} more
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
