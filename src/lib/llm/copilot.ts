import { prisma } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import { clusterHasTokenOverlap } from '@/lib/text'

export const COPILOT_SYSTEM = `You are Scour Copilot, a concise shopping agent inside Scour — a tool that searches many stores and compares products side by side.

You may receive current-page product context, the result of a live Scour MCP tool call, or both. Help users find products, compare live results, check for cheaper offers, and make practical buying decisions.

Rules:
- Treat MCP tool output as authoritative for the search just performed. Otherwise, use only the current-page context and conversation.
- Be brief and practical — a few sentences or a short bulleted list. Plain text only: no markdown tables, no headings.
- Never invent prices, specs, retailers, or reviews that aren't in the context.
- When you name a product, use its real title. Prefer the strongest relevant value, not blindly the lowest-priced weak match.
- Do not say that you cannot search: the routing agent may already have run a Scour MCP tool. If a tool returned no matches, say so plainly and suggest a useful refinement.`

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
