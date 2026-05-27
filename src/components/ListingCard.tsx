import type { NormalizedListing } from '@/lib/adapters/types'
import { formatPrice } from '@/lib/format'

export function ListingCard({
  listing,
  retailerLabel,
}: {
  listing: NormalizedListing
  retailerLabel?: string
}) {
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
        <div className="absolute right-2 top-2 rounded-md bg-bg/85 px-2 py-1 font-mono text-[12px] font-bold text-accent-strong backdrop-blur-sm">
          {formatPrice(listing.priceMinor, listing.currency)}
        </div>
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
