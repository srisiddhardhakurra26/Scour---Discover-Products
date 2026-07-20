export type TrendPoint = { t: number; priceMinor: number }

const HOUR_MS = 1000 * 60 * 60

// Aggregate the lowest observed price per hour across all of a product's
// listings into a time-ordered series. Hourly buckets keep the series compact
// while still showing intra-day drops. Shared by the search product cards
// (rendered as a sparkline) and the wishlist dashboard (full chart).
export function minPriceTrend(
  listings: Array<{
    currency?: string
    prices: Array<{ priceMinor: number; capturedAt: Date; currency?: string }>
  }>,
  currency?: string,
): TrendPoint[] {
  const minByBucket = new Map<number, number>()
  for (const l of listings) {
    for (const obs of l.prices) {
      if (currency && (obs.currency ?? l.currency) !== currency) continue
      const bucket = Math.floor(obs.capturedAt.getTime() / HOUR_MS) * HOUR_MS
      const cur = minByBucket.get(bucket)
      if (cur === undefined || obs.priceMinor < cur) minByBucket.set(bucket, obs.priceMinor)
    }
  }
  return [...minByBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, priceMinor]) => ({ t, priceMinor }))
}
