import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildScourMcpServer } from '@/lib/mcp-server'
import { formatPrice } from '@/lib/format'
import type {
  CopilotProductPreview,
  CopilotToolName,
  CopilotToolPresentation,
} from '@/lib/copilot-protocol'
import type {
  CopilotToolCall,
  CopilotToolDefinition,
} from '@/lib/llm/copilot-planner'

export type CopilotMcpOutput = {
  text: string
  payload: unknown
  presentation: CopilotToolPresentation
}

type ScourMcpSession = {
  listTools(): Promise<CopilotToolDefinition[]>
  callTool(call: CopilotToolCall): Promise<CopilotMcpOutput>
  close(): Promise<void>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((row): row is Record<string, unknown> => row !== null)
    : []
}

function string(value: unknown, max = 500): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeWebUrl(value: unknown): string | undefined {
  const raw = string(value, 2000)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function productPreview(row: Record<string, unknown>): CopilotProductPreview | null {
  const title = string(row.title, 300)
  const store = string(row.store, 100)
  const url = safeWebUrl(row.url)
  if (!title || !store || !url) return null

  let price = string(row.price, 40)
  if (!price) {
    const priceMinor = number(row.priceMinor)
    const currency = string(row.currency, 8)
    if (priceMinor != null && currency) price = formatPrice(priceMinor, currency)
  }
  if (!price) price = 'Price unavailable'

  return {
    title,
    price,
    store,
    url,
    imageUrl: safeWebUrl(row.imageUrl),
  }
}

export function toolStatus(name: CopilotToolName): string {
  switch (name) {
    case 'search_products':
      return 'Searching every enabled store…'
    case 'find_cheaper':
      return 'Checking other stores for a better price…'
    case 'run_shopping_mission':
      return 'Planning searches and ranking the best picks…'
    case 'list_sources':
      return 'Checking Scour’s active sources…'
  }
}

export function presentToolResult(
  name: CopilotToolName,
  payload: unknown,
): CopilotToolPresentation {
  const data = record(payload) ?? {}

  if (name === 'search_products') {
    const query = string(data.query, 200) ?? 'products'
    const products = rows(data.results)
      .map(productPreview)
      .filter((item): item is CopilotProductPreview => item !== null)
      .slice(0, 6)
    const storesSearched = number(data.storesSearched) ?? 0
    const storesHit = number(data.storesHit) ?? 0
    return {
      name,
      label: `Search: “${query}”`,
      summary: `${products.length} top result${products.length === 1 ? '' : 's'} from ${storesHit} of ${storesSearched} stores searched.`,
      href: safeWebUrl(data.scourUrl),
      products,
    }
  }

  if (name === 'find_cheaper') {
    const alternatives = rows(data.alternatives)
      .map(productPreview)
      .filter((item): item is CopilotProductPreview => item !== null)
      .slice(0, 6)
    return {
      name,
      label: 'Price check',
      summary:
        string(data.headline, 240) ??
        `${alternatives.length} alternative${alternatives.length === 1 ? '' : 's'} found.`,
      href: safeWebUrl(data.scourUrl),
      products: alternatives,
    }
  }

  if (name === 'run_shopping_mission') {
    const plan = record(data.plan)
    const products = rows(data.picks)
      .map(productPreview)
      .filter((item): item is CopilotProductPreview => item !== null)
      .slice(0, 5)
    return {
      name,
      label: 'Shopping mission',
      summary:
        string(plan?.summary, 300) ??
        `${products.length} ranked pick${products.length === 1 ? '' : 's'} found.`,
      href: safeWebUrl(rows(data.scourSearchUrls)[0]?.url),
      products,
    }
  }

  const enabled = number(data.enabled) ?? 0
  const total = number(data.total) ?? 0
  return {
    name,
    label: 'Scour sources',
    summary: `${enabled} of ${total} configured sources are enabled.`,
    href: safeWebUrl(data.manageUrl),
    products: [],
  }
}

function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

/**
 * Connect the in-app Copilot to the exact MCP server exposed at /api/mcp.
 * In-memory transport avoids a loopback HTTP request while preserving MCP
 * discovery, validation, and tool-call behavior.
 */
export async function openScourMcpSession(baseUrl: string): Promise<ScourMcpSession> {
  const server = buildScourMcpServer(baseUrl)
  const client = new Client({ name: 'scour-copilot', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return {
    async listTools() {
      const result = await client.listTools()
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
    },

    async callTool(call) {
      const result = await client.callTool({
        name: call.name,
        arguments: call.arguments,
      })
      const outputText = (Array.isArray(result.content) ? result.content : [])
        .map(record)
        .filter(
          (item): item is Record<string, unknown> & { type: 'text'; text: string } =>
            item?.type === 'text' && typeof item.text === 'string',
        )
        .map((item) => item.text)
        .join('\n')
      if (result.isError) throw new Error(outputText || `${call.name} failed`)
      const payload = parsePayload(outputText)
      return {
        text: outputText,
        payload,
        presentation: presentToolResult(call.name, payload),
      }
    },

    async close() {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
    },
  }
}

export function fallbackToolAnswer(tool: CopilotToolPresentation): string {
  if (tool.name === 'list_sources') return tool.summary
  if (tool.products.length === 0) {
    return `${tool.summary} I didn’t find a strong product match this time. Try a more specific description or a different budget.`
  }
  const top = tool.products
    .slice(0, 3)
    .map((product) => `${product.title} (${product.price} at ${product.store})`)
    .join('; ')
  return `${tool.summary} Top options: ${top}. Open a result below to see it at the retailer.`
}
