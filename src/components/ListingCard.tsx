import type { NormalizedListing } from '@/lib/adapters/types'
import { formatPrice } from '@/lib/format'

const TYPE_DOT: Record<string, string> = {
  shopify: 'bg-emerald-400',
  woocommerce: 'bg-violet-400',
  reddit: 'bg-orange-400',
  rss: 'bg-amber-400',
  ebay: 'bg-blue-400',
  etsy: 'bg-pink-400',
  bestbuy: 'bg-yellow-400',
  mock: 'bg-fg-subtle',
}

export function ListingCard({
  listing,
  retailerLabel,
  retailerType,
  showRetailerBadge = false,
}: {
  listing: NormalizedListing
  retailerLabel?: string
  retailerType?: string
  showRetailerBadge?: boolean
}) {
  const dotCls = retailerType ? TYPE_DOT[retailerType] ?? TYPE_DOT.mock : TYPE_DOT.mock

  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-bg-hover"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-bg-elevated">
        {listing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-fg-subtle">
            no image
          </div>
        )}
        {/* Price chip */}
        <div className="absolute right-2 top-2 rounded-md bg-bg/85 px-2 py-1 font-mono text-[12px] font-bold text-accent-strong shadow-sm backdrop-blur-md">
          {formatPrice(listing.priceMinor, listing.currency)}
        </div>
        {/* Retailer badge (unified-view only) */}
        {showRetailerBadge && retailerLabel && (
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-bg/85 px-1.5 py-1 text-[10px] font-medium text-fg shadow-sm backdrop-blur-md">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotCls}`} />
            <span className="max-w-[110px] truncate">{retailerLabel}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="line-clamp-2 min-h-[2.5em] text-[13px] leading-tight text-fg">
          {listing.title}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-fg-subtle">
          <span className="truncate">
            {listing.sellerName ?? retailerLabel ?? ''}
          </span>
          {listing.reviewAvg !== undefined && listing.reviewAvg > 0 && (
            <span className="shrink-0 font-mono tabular-nums">
              ★ {listing.reviewAvg.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </a>
  )
}
