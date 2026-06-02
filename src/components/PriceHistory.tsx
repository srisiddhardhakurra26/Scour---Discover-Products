import { formatPrice } from '@/lib/format'
import type { TrendPoint } from '@/lib/price-history'

// Full-width price-history chart for the wishlist dashboard: a filled line of
// lowest-price-over-time with min/max price labels and a low-price marker.
// Presentational and server-renderable (plain SVG, no client state).
export function PriceHistory({
  points,
  currency,
  width = 360,
  height = 96,
}: {
  points: TrendPoint[]
  currency: string
  width?: number
  height?: number
}) {
  if (points.length < 2) {
    return (
      <p className="font-mono text-[11px] text-fg-subtle">
        Not enough price history yet — re-run a search a few times to build a trend.
      </p>
    )
  }

  const prices = points.map((p) => p.priceMinor)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const padY = 10
  const padX = 2

  const x = (i: number) => (i / (points.length - 1)) * (width - padX * 2) + padX
  const y = (v: number) => height - padY - ((v - min) / range) * (height - padY * 2)

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.priceMinor).toFixed(1)}`)
    .join(' ')
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${height} L ${x(0).toFixed(1)} ${height} Z`

  const first = prices[0]
  const last = prices[prices.length - 1]
  const trendDown = last < first
  const trendUp = last > first
  const color = trendDown
    ? 'var(--color-success)'
    : trendUp
      ? 'var(--color-danger)'
      : 'var(--color-fg-subtle)'

  const minIdx = prices.indexOf(min)
  const gradientId = `pg-${min}-${max}-${points.length}`

  return (
    <div className="flex flex-col gap-1">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
        role="img"
        aria-label={`Price history: low ${formatPrice(min, currency)}, high ${formatPrice(max, currency)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={x(minIdx)} cy={y(min)} r="2.5" fill="var(--color-success)" />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-fg-subtle">
        <span>
          low <span className="text-success">{formatPrice(min, currency)}</span>
        </span>
        <span>
          {points.length} pts · {trendDown ? 'down' : trendUp ? 'up' : 'flat'}
        </span>
        <span>
          high <span className="text-fg-muted">{formatPrice(max, currency)}</span>
        </span>
      </div>
    </div>
  )
}
