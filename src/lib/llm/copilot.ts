import { prisma } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import { clusterHasTokenOverlap } from '@/lib/text'

export const COPILOT_SYSTEM = `You are Scour Copilot, a concise shopping assistant inside Scour — a tool that finds the same product across many stores and compares prices side by side.

Your job: help the user decide among the products listed in the context below. Compare prices, point out the best deal, weigh the price spread across stores, and suggest what to search for next.

Rules:
- Use ONLY the products in the context. If the user asks about something not listed, say you only see the current results and suggest they search for it.
- Be brief and practical — a few sentences or a short bulleted list. Plain text only: no markdown tables, no headings.
- Never invent prices, specs, retailers, or reviews that aren't in the context.
- When you name a product, use its real title from the context. Prefer the cheapest option unless the user signals other priorities.`

/**
 * Compact, text-only description of the products currently compared for a
 * query, used to ground the Copilot. Pulls the most recently clustered
 * products (those a just-run search refreshed) and keeps the ones whose titles
 * overlap the query — a lightweight relevance pass that avoids re-running the
 * embedding ranker. Best-effort: returns a short note if nothing matches.
 */
export async function buildCopilotContext(
  query: string,
  retailerIds?: string[],
): Promise<string> {
  const listingWhere = {
    retailer: { is: { enabled: true } },
    ...(retailerIds ? { retailerId: { in: retailerIds } } : {}),
  }
  const candidates = await prisma.product.findMany({
    where: { listings: { some: listingWhere } },
    include: {
      listings: {
        where: listingWhere,
        orderBy: { priceMinor: 'asc' },
        include: { retailer: { select: { id: true, label: true, type: true } } },
      },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 30,
  })

  const products = candidates.filter(
    (product) => new Set(product.listings.map((listing) => listing.retailer.id)).size >= 2,
  )
  const relevant = products
    .filter((product) =>
      query
        ? clusterHasTokenOverlap(query, [
            product.canonicalTitle,
            ...product.listings.map((listing) => listing.title),
          ])
        : true,
    )
    .slice(0, 8)

  if (relevant.length === 0) {
    return query
      ? `The user searched "${query}", but no compared products are loaded yet.`
      : 'No products are loaded yet.'
  }

  const lines = relevant.map((p, i) => {
    const byCurrency = new Map<string, number[]>()
    for (const listing of p.listings) {
      if (listing.priceMinor <= 0) continue
      const prices = byCurrency.get(listing.currency) ?? []
      prices.push(listing.priceMinor)
      byCurrency.set(listing.currency, prices)
    }
    const range =
      byCurrency.size === 0
        ? 'price n/a'
        : [...byCurrency.entries()]
            .map(([currency, prices]) => {
              const lo = Math.min(...prices)
              const hi = Math.max(...prices)
              return lo === hi
                ? formatPrice(lo, currency)
                : `${formatPrice(lo, currency)}–${formatPrice(hi, currency)}`
            })
            .join(', ')
    const stores = [...new Set(p.listings.map((l) => l.retailer.label ?? l.retailer.type))]
      .slice(0, 5)
      .join(', ')
    const storeCount = new Set(p.listings.map((listing) => listing.retailer.id)).size
    return `${i + 1}. ${p.canonicalTitle} — ${range} across ${storeCount} stores (${stores})`
  })

  return `Products currently compared${query ? ` for "${query}"` : ''}:\n${lines.join('\n')}`
}
