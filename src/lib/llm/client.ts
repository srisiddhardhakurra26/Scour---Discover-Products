import { fetchSafeRemote } from '@/lib/url-safety'

// Minimal multi-provider LLM client. Tries Groq first (fastest free tier),
// falls back to Gemini if Groq is unavailable or rate-limited. Both providers
// support JSON-mode output, which is what every Scour agent uses.

type JsonOptions = {
  system: string
  user: string
  // Hint for picking a model: 'fast' uses smaller models (Llama 3.1 8B, Gemini
  // Flash); 'reasoning' uses larger (Llama 3.3 70B, Gemini Pro).
  tier: 'fast' | 'reasoning'
  // Soft cap on output tokens.
  maxTokens?: number
  // If true, allow callers to pass a schema; both providers respect it as a
  // guidance hint but enforcement varies.
  schemaHint?: unknown
}

class LlmError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    message: string,
  ) {
    super(message)
  }
}

async function tryGroq(opts: JsonOptions, signal: AbortSignal): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new LlmError('groq', null, 'GROQ_API_KEY not set')

  const model =
    opts.tier === 'reasoning' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant'

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    signal,
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new LlmError('groq', res.status, `${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new LlmError('groq', null, 'empty response')
  return content
}

async function tryGemini(opts: JsonOptions, signal: AbortSignal): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new LlmError('gemini', null, 'GEMINI_API_KEY not set')

  const model = opts.tier === 'reasoning' ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite'

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
  const res = await fetch(url, {
    signal,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'system', parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: opts.maxTokens ?? 1024,
        responseMimeType: 'application/json',
        // Gemini 2.5 spends tokens "thinking" before emitting output, which
        // can blow the budget and truncate the JSON. Disable for deterministic
        // JSON jobs — we don't need chain-of-thought to emit selectors.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new LlmError('gemini', res.status, `${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new LlmError('gemini', null, 'empty response')
  return stripJsonFences(content)
}

// Some providers occasionally wrap JSON output in ```json ... ``` fences even
// when asked for raw JSON. Strip them so JSON.parse doesn't choke.
function stripJsonFences(s: string): string {
  const trimmed = s.trim()
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  }
  return trimmed
}

/**
 * Generate a JSON response. Tries Groq, falls back to Gemini. Throws if
 * neither succeeds. Callers parse and validate the returned string.
 */
export async function generateJson(
  opts: JsonOptions,
  signal: AbortSignal = AbortSignal.timeout(15_000),
): Promise<string> {
  const errors: string[] = []
  try {
    const groqBudgetMs = opts.tier === 'reasoning' ? 6_000 : 2_500
    const groqSignal = AbortSignal.any([signal, AbortSignal.timeout(groqBudgetMs)])
    return await tryGroq(opts, groqSignal)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  try {
    return await tryGemini(opts, signal)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  throw new Error(`all LLM providers failed: ${errors.join(' | ')}`)
}

// --- Vision (images + JSON out) -------------------------------------------
// Gemini-only: it's the existing fallback provider and its free tier accepts
// inline images. Callers must degrade gracefully when this throws (no key,
// rate limit) — vision is never on the critical path.

export type InlineImage = { mimeType: string; dataBase64: string }

export async function generateJsonVision(
  opts: { system: string; user: string; images: InlineImage[]; maxTokens?: number },
  signal: AbortSignal = AbortSignal.timeout(15_000),
): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new LlmError('gemini', null, 'GEMINI_API_KEY not set')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`
  const res = await fetch(url, {
    signal,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'system', parts: [{ text: opts.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: opts.user },
            ...opts.images.map((img) => ({
              inlineData: { mimeType: img.mimeType, data: img.dataBase64 },
            })),
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: opts.maxTokens ?? 1024,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new LlmError('gemini', res.status, `${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new LlmError('gemini', null, 'empty response')
  return stripJsonFences(content)
}

/**
 * Fetch an image and return it inline-ready for generateJsonVision. Size- and
 * time-capped; returns null on any failure so callers can fall back to text.
 */
export async function fetchInlineImage(
  url: string,
  timeoutMs = 1500,
  maxBytes = 600_000,
): Promise<InlineImage | null> {
  try {
    const res = await fetchSafeRemote(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > maxBytes) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > maxBytes) return null
    return { mimeType, dataBase64: Buffer.from(buf).toString('base64') }
  } catch {
    return null
  }
}

// --- Conversational text (Copilot) ---------------------------------------
// generateJson is single-shot JSON; the Copilot needs multi-turn, streamed,
// free-text output. These helpers stay separate so the JSON agents are
// unaffected, and they keep the same Groq-first / Gemini-fallback shape.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type ChatOptions = { tier: 'fast' | 'reasoning'; maxTokens?: number }

async function* streamGroqText(
  messages: ChatMessage[],
  opts: ChatOptions,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new LlmError('groq', null, 'GROQ_API_KEY not set')

  const model =
    opts.tier === 'reasoning' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant'

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    signal,
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: opts.maxTokens ?? 700,
      stream: true,
      messages,
    }),
  })
  // Any failure here happens before we yield, so callers can safely fall back.
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new LlmError('groq', res.status, `${res.status}: ${body.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        // keep-alive or split frame — ignore
      }
    }
  }
}

async function geminiText(
  messages: ChatMessage[],
  opts: ChatOptions,
  signal: AbortSignal,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new LlmError('gemini', null, 'GEMINI_API_KEY not set')

  const model = opts.tier === 'reasoning' ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite'
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
  const res = await fetch(url, {
    signal,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { role: 'system', parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: opts.maxTokens ?? 700,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new LlmError('gemini', res.status, `${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!content) throw new LlmError('gemini', null, 'empty response')
  return content
}

/**
 * Stream a plain-text chat completion as a sequence of text deltas. Tries Groq
 * (true token streaming); if Groq fails before any output, falls back to a
 * single-shot Gemini response yielded as one chunk. Throws only if both
 * providers fail — the Copilot route turns that into a graceful message.
 */
export async function* streamText(
  messages: ChatMessage[],
  opts: ChatOptions = { tier: 'fast' },
  signal: AbortSignal = AbortSignal.timeout(30_000),
): AsyncGenerator<string> {
  let yielded = false
  try {
    const groqSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
    for await (const delta of streamGroqText(messages, opts, groqSignal)) {
      yielded = true
      yield delta
    }
    return
  } catch (err) {
    // Falling back after streaming partial text would append a second answer.
    // Let the route close with its graceful unavailable message instead.
    if (yielded) throw err
    console.warn('[copilot] groq stream failed, falling back to gemini:', err)
  }
  yield await geminiText(messages, opts, signal)
}
