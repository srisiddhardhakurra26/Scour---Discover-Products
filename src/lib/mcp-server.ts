import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getAdapters, ADAPTER_TIMEOUT_MS } from '@/lib/adapters/registry'
import { searchAllAdapters } from '@/lib/fanout'
import { formatPrice } from '@/lib/format'
import { lookupProduct, lookupHeadline } from '@/lib/lookup'
import { runMission } from '@/lib/mission'
import { prisma } from '@/lib/db'

const NON_SHOP_TYPES = new Set(['reddit', 'rss', 'mock'])

/** Wrap a payload as an MCP text result (JSON keeps it model-readable everywhere). */
function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] }
}

/**
 * Scour as an MCP server: the same search/lookup/mission internals the web
 * app uses, exposed as tools any MCP client (Claude, ChatGPT, …) can call.
 * Stateless — build one per request with the request's origin for deep links.
 */
export function buildScourMcpServer(baseUrl: string): McpServer {
  const base = baseUrl.replace(/\/$/, '')

  const server = new McpServer(
    { name: 'scour', version: '0.1.0' },
    {
      instructions:
        'Scour searches many retail stores in parallel and compares products. ' +
        'Use search_products for direct product searches, find_cheaper to check a specific ' +
        'product for better prices elsewhere, and run_shopping_mission for open-ended goals ' +
        '(gifts, kits, multi-item setups). Results always deep-link to the real retailer — ' +
        'Scour never handles checkout.',
    },
  )

  server.registerTool(
    'search_products',
    {
      title: 'Search products across stores',
      description:
        'Search all of Scour\'s enabled retail sources (eBay, Amazon, Etsy, Best Buy, ' +
        'user-added storefronts, …) in parallel. Call this when the user wants to find a ' +
        'product or compare prices/availability across stores. Price constraints can go ' +
        'directly in the query ("wireless earbuds under $80"). Returns listings ranked by ' +
        'relevance with price, store, and a deep link to the retailer.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Product search phrase, e.g. "mechanical keyboard under $120"'),
        max_results: z.number().int().min(1).max(25).optional().describe('Maximum listings to return (default 10)'),
      },
    },
    async ({ query, max_results }) => {
      const limit = max_results ?? 10
      const adapters = (await getAdapters()).filter((a) => !NON_SHOP_TYPES.has(a.type))
      const results = await searchAllAdapters(adapters, query, ADAPTER_TIMEOUT_MS)

      let storesHit = 0
      const listings: {
        title: string
        price: string
        priceMinor: number
        currency: string
        store: string
        url: string
        imageUrl?: string
        relevance: number
        cached: boolean
      }[] = []
      for (const r of results) {
        if (r.failed || r.kept.length === 0) continue
        storesHit++
        for (const item of r.kept.slice(0, 5)) {
          const l = item.listing
          if (!l.priceMinor || l.priceMinor <= 0) continue
          listings.push({
            title: l.title,
            price: formatPrice(l.priceMinor, l.currency || 'USD'),
            priceMinor: l.priceMinor,
            currency: l.currency || 'USD',
            store: r.adapter.label,
            url: l.url,
            imageUrl: l.imageUrl,
            relevance: Number(item.score.toFixed(3)),
            cached: r.fromCache,
          })
        }
      }
      listings.sort((a, b) => {
        if (Math.abs(b.relevance - a.relevance) > 0.04) return b.relevance - a.relevance
        return a.priceMinor - b.priceMinor
      })

      return json({
        query,
        storesSearched: adapters.length,
        storesHit,
        results: listings.slice(0, limit),
        scourUrl: `${base}/search?q=${encodeURIComponent(query)}`,
      })
    },
  )

  server.registerTool(
    'find_cheaper',
    {
      title: 'Find cheaper alternatives for a product',
      description:
        'Given a specific product (title, optionally its current price and the page it was ' +
        'seen on), search other stores for the same or equivalent item and report cheaper ' +
        'offers and potential savings. Call this when the user already has a product in mind ' +
        'and wants to know if it is cheaper elsewhere.',
      inputSchema: {
        title: z.string().min(1).max(300).describe('The product title as seen on the retailer page'),
        price: z.number().positive().optional().describe('Current price in major units, e.g. 79.99'),
        currency: z.string().max(8).optional().describe('ISO currency code (default USD)'),
        page_url: z.string().max(2000).optional().describe('URL of the page the product was seen on — offers from that store are excluded'),
      },
    },
    async ({ title, price, currency, page_url }) => {
      const result = await lookupProduct({
        title,
        priceMinor: price != null ? Math.round(price * 100) : null,
        currency,
        pageUrl: page_url,
        baseUrl: base,
      })
      return json({ headline: lookupHeadline(result), ...result })
    },
  )

  server.registerTool(
    'run_shopping_mission',
    {
      title: 'Run a shopping mission',
      description:
        'Turn an open-ended shopping goal ("gift for dad under $50 who likes coffee", ' +
        '"starter kitchen kit") into a plan of 2–5 concrete product searches, run them all ' +
        'across every store, and return a ranked shortlist of picks with reasons. Call this ' +
        'for gift briefs, kits, and multi-product goals — for a single direct product search ' +
        'use search_products instead. Takes 10–30 seconds.',
      inputSchema: {
        mission: z.string().min(1).max(500).describe('The shopping goal in plain English'),
      },
    },
    async ({ mission }) => {
      const result = await runMission(mission, { baseUrl: base })
      return json(result)
    },
  )

  server.registerTool(
    'list_sources',
    {
      title: 'List Scour retail sources',
      description:
        'List the retail sources Scour searches, with type, enabled state, and last-error ' +
        'status. Call this when the user asks which stores are covered or why a store is missing.',
      inputSchema: {},
    },
    async () => {
      const rows = await prisma.retailer.findMany({
        orderBy: [{ enabled: 'desc' }, { label: 'asc' }],
        select: {
          type: true,
          identifier: true,
          label: true,
          enabled: true,
          lastFetchedAt: true,
          lastError: true,
        },
      })
      return json({
        total: rows.length,
        enabled: rows.filter((r) => r.enabled).length,
        sources: rows.map((r) => ({
          label: r.label ?? r.identifier,
          type: r.type,
          identifier: r.identifier,
          enabled: r.enabled,
          lastFetchedAt: r.lastFetchedAt?.toISOString() ?? null,
          lastError: r.lastError,
        })),
        manageUrl: `${base}/sources`,
      })
    },
  )

  return server
}
