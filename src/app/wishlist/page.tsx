import Link from 'next/link'
import { prisma } from '@/lib/db'
import { Header } from '@/components/Header'
import { formatPrice } from '@/lib/format'
import { minPriceTrend } from '@/lib/price-history'
import { PriceHistory } from '@/components/PriceHistory'
import { WishlistControls, RemoveSaved } from './WishlistControls'

// Always reflect the latest saves and freshly-observed prices.
export const dynamic = 'force-dynamic'

async function getWishlist() {
  const saved = await prisma.savedProduct.findMany({ orderBy: { createdAt: 'desc' } })
  if (saved.length === 0) return []

  const products = await prisma.product.findMany({
    where: { id: { in: saved.map((s) => s.productId) } },
    include: {
      listings: {
        include: {
          retailer: { select: { id: true, label: true, type: true } },
          prices: {
            orderBy: { capturedAt: 'desc' },
            select: { priceMinor: true, capturedAt: true, currency: true },
            take: 60,
          },
        },
        orderBy: { priceMinor: 'asc' },
      },
    },
  })
  const byId = new Map(products.map((p) => [p.id, p]))
  return saved.map((s) => ({ saved: s, product: byId.get(s.productId) ?? null }))
}

type WishlistItem = Awaited<ReturnType<typeof getWishlist>>[number]
type WishlistProduct = NonNullable<WishlistItem['product']>

export default async function WishlistPage() {
  const items = await getWishlist()

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
          <p className="text-sm text-fg-muted">
            Saved products with lowest-price history across stores. Set a target and a drop
            below it is flagged next time you open this page.
          </p>
        </header>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-bg-card p-16 text-center">
            <p className="text-sm text-fg-muted">No saved products yet.</p>
            <p className="font-mono text-[11px] text-fg-subtle">
              Tap the{' '}
              <span className="text-accent">♥</span> on any product card to track it here.
            </p>
            <Link
              href="/"
              className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-strong"
            >
              Start scouring
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((item) =>
              item.product ? (
                <WishlistCard
                  key={item.saved.id}
                  alertBelowMinor={item.saved.alertBelowMinor}
                  product={item.product}
                />
              ) : (
                <div
                  key={item.saved.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-card p-4"
                >
                  <span className="text-sm text-fg-muted">
                    This product is no longer tracked.
                  </span>
                  <RemoveSaved productId={item.saved.productId} />
                </div>
              ),
            )}
          </div>
        )}
      </main>
    </>
  )
}

function WishlistCard({
  alertBelowMinor,
  product,
}: {
  alertBelowMinor: number | null
  product: WishlistProduct
}) {
  // Cheapest listing per retailer.
  const dedupedMap = new Map<string, WishlistProduct['listings'][number]>()
  for (const l of [...product.listings].sort((a, b) => {
    const ap = a.priceMinor > 0 ? a.priceMinor : Number.MAX_SAFE_INTEGER
    const bp = b.priceMinor > 0 ? b.priceMinor : Number.MAX_SAFE_INTEGER
    return ap - bp
  })) {
    const key = l.retailer.id
    if (!dedupedMap.has(key)) dedupedMap.set(key, l)
  }
  const deduped = [...dedupedMap.values()]
  const lowest = deduped[0]
  const currency = lowest?.currency ?? 'USD'
  const trend = minPriceTrend(product.listings, currency)
  const targetHit =
    alertBelowMinor != null &&
    lowest != null &&
    lowest.priceMinor > 0 &&
    lowest.priceMinor <= alertBelowMinor

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-bg-card p-4 transition-colors ${
        targetHit ? 'border-success/50' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex gap-3">
        <a
          href={lowest?.url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-bg-elevated"
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
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-2 text-sm font-medium leading-tight text-fg">
              {product.canonicalTitle}
            </h2>
            {targetHit && (
              <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-success">
                target hit
              </span>
            )}
          </div>
          {lowest && (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg font-bold tabular-nums text-accent-strong">
                {formatPrice(lowest.priceMinor, currency)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                lowest · {deduped.length} store{deduped.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </div>

      <ul className="flex flex-col">
        {deduped.slice(0, 5).map((l, i) => (
          <li key={l.id}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="-mx-1 flex items-baseline justify-between gap-2 rounded border-t border-border/50 px-1 py-1.5 text-[11px] transition-colors first:border-t-0 first:pt-0 hover:bg-bg-hover/50"
            >
              <span className="truncate text-fg-muted">{l.retailer.label ?? l.retailer.type}</span>
              <span
                className={`shrink-0 font-mono font-bold tabular-nums ${i === 0 ? 'text-accent-strong' : 'text-fg-muted'}`}
              >
                {l.priceMinor > 0 ? formatPrice(l.priceMinor, l.currency) : 'unavailable'}
              </span>
            </a>
          </li>
        ))}
      </ul>

      <PriceHistory points={trend} currency={currency} />

      <WishlistControls productId={product.id} alertBelowMinor={alertBelowMinor} />
    </div>
  )
}
