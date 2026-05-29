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
 * Generate a JSON response. Tries Groq, falls back to Gemini. Throws if
 * neither succeeds. Callers parse and validate the returned string.
 */
export async function generateJson(
  opts: JsonOptions,
  signal: AbortSignal = AbortSignal.timeout(15_000),
): Promise<string> {
  const errors: string[] = []
  try {
    return await tryGroq(opts, signal)
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
