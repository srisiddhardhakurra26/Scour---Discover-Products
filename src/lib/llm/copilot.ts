import { prisma } from '@/lib/db'
import { formatPrice } from '@/lib/format'

export const COPILOT_SYSTEM = `You are Scour Copilot, a concise shopping assistant inside Scour — a tool that finds the same product across many stores and compares prices side by side.

Your job: help the user decide among the products listed in the context below. Compare prices, point out the best deal, weigh the price spread across stores, and suggest what to search for next.

Rules:
- Use ONLY the products in the context. If the user asks about something not listed, say you only see the current results and suggest they search for it.
- Be brief and practical — a few sentences or a short bulleted list. Plain text only: no markdown tables, no headings.
- Never invent prices, specs, retailers, or reviews that aren't in the context.
- When you name a product, use its real title from the context. Prefer the cheapest option unless the user signals other priorities.`

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

/**
 * Compact, text-only description of the products currently compared for a
 * query, used to ground the Copilot. Pulls the most recently clustered
 * products (those a just-run search refreshed) and keeps the ones whose titles
 * overlap the query — a lightweight relevance pass that avoids re-running the
 * embedding ranker. Best-effort: returns a short note if nothing matches.
 */
export async function buildCopilotContext(query: string): Promise<string> {
  const products = await prisma.product.findMany({
    where: { retailerCount: { gte: 2 } },
    include: {
      listings: {
        orderBy: { priceMinor: 'asc' },
        include: { retailer: { select: { label: true, type: true } } },
      },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 30,
  })

  const tokens = tokenize(query)
  const relevant = (
    tokens.length === 0
      ? products
      : products.filter((p) => {
          const hay = `${p.canonicalTitle} ${p.listings.map((l) => l.title).join(' ')}`.toLowerCase()
          return tokens.some((t) => hay.includes(t))
        })
  ).slice(0, 8)

  if (relevant.length === 0) {
    return query
      ? `The user searched "${query}", but no compared products are loaded yet.`
      : 'No products are loaded yet.'
  }

  const lines = relevant.map((p, i) => {
    const prices = p.listings.map((l) => l.priceMinor).filter((n) => n > 0)
    const currency = p.listings[0]?.currency ?? 'USD'
    const lo = prices.length ? Math.min(...prices) : 0
    const hi = prices.length ? Math.max(...prices) : 0
    const range =
      prices.length === 0
        ? 'price n/a'
        : lo === hi
          ? formatPrice(lo, currency)
          : `${formatPrice(lo, currency)}–${formatPrice(hi, currency)}`
    const stores = [...new Set(p.listings.map((l) => l.retailer.label ?? l.retailer.type))]
      .slice(0, 5)
      .join(', ')
    return `${i + 1}. ${p.canonicalTitle} — ${range} across ${p.retailerCount} stores (${stores})`
  })

  return `Products currently compared${query ? ` for "${query}"` : ''}:\n${lines.join('\n')}`
}
