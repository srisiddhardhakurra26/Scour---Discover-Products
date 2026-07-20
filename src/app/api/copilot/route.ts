import { streamText, type ChatMessage } from '@/lib/llm/client'
import { buildCopilotContext, COPILOT_SYSTEM } from '@/lib/llm/copilot'

// Needs Prisma (Node-only) for grounding context.
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

  // Keep only well-formed user/assistant turns, cap history + per-message length.
  const history: ChatMessage[] = incoming
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    )
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))

  if (history.length === 0) return new Response('No messages.', { status: 400 })

  const context = await buildCopilotContext(query, sourceIds).catch(() => '')
  const messages: ChatMessage[] = [
    { role: 'system', content: `${COPILOT_SYSTEM}\n\n${context}` },
    ...history,
  ]

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of streamText(messages, { tier: 'fast', maxTokens: 700 })) {
          controller.enqueue(encoder.encode(delta))
        }
      } catch (err) {
        console.error('[copilot] stream error:', err)
        controller.enqueue(
          encoder.encode(
            "\n\n_Copilot is unavailable right now — the AI providers didn't respond. Search still works._",
          ),
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
