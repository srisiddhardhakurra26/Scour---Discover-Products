import { generateJson, type ChatMessage } from '@/lib/llm/client'
import {
  COPILOT_TOOL_NAMES,
  type CopilotToolName,
} from '@/lib/copilot-protocol'

export type CopilotToolCall = {
  name: CopilotToolName
  arguments: Record<string, unknown>
}

export type CopilotToolDefinition = {
  name: string
  description?: string
  inputSchema?: unknown
}

type ParsedDecision =
  | { kind: 'none' }
  | { kind: 'tool'; call: CopilotToolCall }

const PLANNER_SYSTEM = `You are the tool-routing agent for Scour, a multi-store shopping assistant.
Choose whether the latest user message requires one MCP tool call. Return ONLY JSON:
{"tool":"search_products|find_cheaper|run_shopping_mission|list_sources|none","arguments":{}}

Routing rules:
- search_products: the user wants to find, browse, or compare prices for a specific product type. Include all requirements and budget in query.
- find_cheaper: the user provides or refers to one specific product and asks for the same item cheaper elsewhere.
- run_shopping_mission: an open-ended gift brief, kit, outfit, setup, or multi-item goal that benefits from several searches.
- list_sources: the user asks which stores/sources Scour covers or whether a source is available.
- none: questions about already-returned results, follow-ups that can be answered from conversation/context, greetings, and non-shopping requests.

Use at most one tool. Never invent details that are not present in the conversation.`

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().slice(0, max)
  return cleaned || null
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

/** Parse and constrain untrusted JSON emitted by the routing model. */
export function parseCopilotDecision(raw: string): ParsedDecision {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid planner response')
  const row = parsed as Record<string, unknown>
  if (row.tool === 'none') return { kind: 'none' }
  if (
    typeof row.tool !== 'string' ||
    !COPILOT_TOOL_NAMES.includes(row.tool as CopilotToolName)
  ) {
    throw new Error('invalid planner tool')
  }

  const args =
    row.arguments && typeof row.arguments === 'object'
      ? (row.arguments as Record<string, unknown>)
      : {}

  if (row.tool === 'search_products') {
    const query = text(args.query, 200)
    if (!query) throw new Error('search query missing')
    const requested = finitePositive(args.max_results)
    const maxResults = requested ? Math.min(10, Math.max(1, Math.round(requested))) : 6
    return {
      kind: 'tool',
      call: { name: row.tool, arguments: { query, max_results: maxResults } },
    }
  }

  if (row.tool === 'find_cheaper') {
    const title = text(args.title, 300)
    if (!title) throw new Error('product title missing')
    const callArgs: Record<string, unknown> = { title }
    const price = finitePositive(args.price)
    const currency = text(args.currency, 8)
    const pageUrl = text(args.page_url, 2000)
    if (price) callArgs.price = price
    if (currency) callArgs.currency = currency.toUpperCase()
    if (pageUrl) callArgs.page_url = pageUrl
    return { kind: 'tool', call: { name: row.tool, arguments: callArgs } }
  }

  if (row.tool === 'run_shopping_mission') {
    const mission = text(args.mission, 500)
    if (!mission) throw new Error('mission missing')
    return {
      kind: 'tool',
      call: { name: row.tool, arguments: { mission } },
    }
  }

  return { kind: 'tool', call: { name: 'list_sources', arguments: {} } }
}

function latestUserText(messages: ChatMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user')?.content.trim() ?? ''
}

/** Useful degradation when no LLM key is configured or the router times out. */
export function fallbackCopilotTool(
  messages: ChatMessage[],
  currentQuery: string,
): CopilotToolCall | null {
  const latest = latestUserText(messages).slice(0, 500)
  if (!latest) return null

  if (/\b(which|what)\s+(stores?|sources?|retailers?)\b|\bwhere do you search\b/i.test(latest)) {
    return { name: 'list_sources', arguments: {} }
  }

  if (/\b(gift|kit|setup|outfit|bundle|shopping mission)\b/i.test(latest)) {
    return { name: 'run_shopping_mission', arguments: { mission: latest } }
  }

  if (/\b(find|check|is there|anything)\b.*\bcheaper\b|\bcheaper elsewhere\b/i.test(latest)) {
    const stripped = latest
      .replace(/\b(find|check|is there|anything)\b/gi, '')
      .replace(/\bcheaper( elsewhere)?\b/gi, '')
      .replace(/\b(for|than|please)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    const title = stripped.length >= 3 ? stripped : currentQuery
    if (title) return { name: 'find_cheaper', arguments: { title: title.slice(0, 300) } }
  }

  if (
    /^(find|search(?: for)?|show me|look for|shop for|i (?:need|want)|where can i buy|compare prices? for)\b/i.test(
      latest,
    )
  ) {
    const query = latest
      .replace(
        /^(?:please\s+)?(?:find|search(?: for)?|show me|look for|shop for|i (?:need|want)|where can i buy|compare prices? for)\s+/i,
        '',
      )
      .trim()
    if (query) {
      return {
        name: 'search_products',
        arguments: { query: query.slice(0, 200), max_results: 6 },
      }
    }
  }

  return null
}

export async function chooseCopilotTool(
  messages: ChatMessage[],
  currentQuery: string,
  tools: CopilotToolDefinition[],
): Promise<CopilotToolCall | null> {
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    return fallbackCopilotTool(messages, currentQuery)
  }
  try {
    const raw = await generateJson(
      {
        system: PLANNER_SYSTEM,
        user: JSON.stringify({
          currentSearch: currentQuery || null,
          conversation: messages.slice(-10),
          availableMcpTools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        }),
        tier: 'fast',
        maxTokens: 300,
      },
      AbortSignal.timeout(10_000),
    )
    const decision = parseCopilotDecision(raw)
    return decision.kind === 'tool' ? decision.call : null
  } catch (err) {
    console.warn('[copilot] tool router failed, using deterministic routing:', err)
    return fallbackCopilotTool(messages, currentQuery)
  }
}
