import { streamText, type ChatMessage } from '@/lib/llm/client'
import { buildCopilotContext, COPILOT_SYSTEM } from '@/lib/llm/copilot'
import { chooseCopilotTool } from '@/lib/llm/copilot-planner'
import {
  fallbackToolAnswer,
  openScourMcpSession,
  toolStatus,
  type CopilotMcpOutput,
} from '@/lib/copilot-mcp'
import type { CopilotStreamEvent } from '@/lib/copilot-protocol'

// Needs Prisma, native SQLite, and the MCP server internals.
export const runtime = 'nodejs'

type IncomingMessage = { role?: unknown; content?: unknown }

export async function POST(req: Request) {
  let body: { query?: unknown; sourceIds?: unknown; messages?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON.', { status: 400 })
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : ''
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds
        .filter(
          (id): id is string =>
            typeof id === 'string' && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id),
        )
        .slice(0, 50)
    : undefined
  const incoming = Array.isArray(body.messages) ? (body.messages as IncomingMessage[]) : []

  const history: ChatMessage[] = incoming
    .filter(
      (message): message is { role: 'user' | 'assistant'; content: string } =>
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
    )
    .slice(-10)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 2000) }))

  if (history.length === 0) return new Response('No messages.', { status: 400 })

  const encoder = new TextEncoder()
  const encode = (event: CopilotStreamEvent) =>
    encoder.encode(`${JSON.stringify(event)}\n`)
  const origin = new URL(req.url).origin

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let toolOutput: CopilotMcpOutput | null = null
      let toolFailed = false
      const contextPromise = buildCopilotContext(query, sourceIds).catch(() => '')

      try {
        controller.enqueue(encode({ type: 'status', message: 'Deciding what to do…' }))
        const session = await openScourMcpSession(origin)
        try {
          const tools = await session.listTools()
          const call = await chooseCopilotTool(history, query, tools)
          if (call) {
            controller.enqueue(encode({ type: 'status', message: toolStatus(call.name) }))
            toolOutput = await session.callTool(call)
            controller.enqueue(encode({ type: 'tool', tool: toolOutput.presentation }))
          }
        } finally {
          await session.close()
        }
      } catch (err) {
        toolFailed = true
        console.error('[copilot] MCP tool call failed:', err)
        controller.enqueue(
          encode({
            type: 'error',
            message: 'I couldn’t complete that store search. You can retry or refine the request.',
          }),
        )
      }

      // Tool-backed searches remain useful without an LLM key. Avoid a known
      // provider failure and summarize the structured MCP result locally.
      if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
        if (toolOutput) {
          controller.enqueue(
            encode({ type: 'text', delta: fallbackToolAnswer(toolOutput.presentation) }),
          )
        } else if (!toolFailed) {
          controller.enqueue(
            encode({
              type: 'error',
              message:
                'Add a Groq or Gemini key to enable open-ended conversation. Direct requests like “find headphones under $100” work without one.',
            }),
          )
        }
        controller.close()
        return
      }

      const context = await contextPromise
      const toolContext = toolOutput
        ? `\n\nMCP tool result (authoritative live data):\n${toolOutput.text.slice(0, 24_000)}`
        : ''
      const messages: ChatMessage[] = [
        { role: 'system', content: `${COPILOT_SYSTEM}\n\n${context}${toolContext}` },
        ...history,
      ]

      let emittedText = false
      try {
        controller.enqueue(
          encode({
            type: 'status',
            message: toolOutput ? 'Reviewing the results…' : 'Writing a response…',
          }),
        )
        for await (const delta of streamText(messages, { tier: 'fast', maxTokens: 700 })) {
          emittedText = true
          controller.enqueue(encode({ type: 'text', delta }))
        }
      } catch (err) {
        console.error('[copilot] response stream failed:', err)
        if (!emittedText) {
          if (toolOutput) {
            controller.enqueue(
              encode({ type: 'text', delta: fallbackToolAnswer(toolOutput.presentation) }),
            )
          } else if (!toolFailed) {
            controller.enqueue(
              encode({
                type: 'error',
                message:
                  'Copilot needs a Groq or Gemini key for conversational answers. Direct product-search requests still work.',
              }),
            )
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
