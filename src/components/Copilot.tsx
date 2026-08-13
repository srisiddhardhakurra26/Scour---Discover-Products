'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type {
  CopilotStreamEvent,
  CopilotToolPresentation,
} from '@/lib/copilot-protocol'

type Msg = {
  role: 'user' | 'assistant'
  content: string
  status?: string
  error?: string
  tools?: CopilotToolPresentation[]
}

const SEARCH_SUGGESTIONS = [
  'Find noise-canceling headphones under $150',
  'Gift for a coffee lover under $50',
  'Which stores can you search?',
]

const RESULTS_SUGGESTIONS = [
  'Which of these is the best deal?',
  'Find similar products under $100',
  'Compare the top two.',
]

export function Copilot() {
  const searchParams = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim().slice(0, 200)
  const sourceIds = (searchParams.get('sources') ?? '')
    .split(',')
    .filter((id) => id && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id))
    .slice(0, 50)
  const suggestions = query ? RESULTS_SUGGESTIONS : SEARCH_SUGGESTIONS

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function updateAssistant(update: (message: Msg) => Msg) {
    setMessages((current) => {
      const copy = [...current]
      const index = copy.length - 1
      if (index < 0 || copy[index].role !== 'assistant') return current
      copy[index] = update(copy[index])
      return copy
    })
  }

  function applyEvent(event: CopilotStreamEvent) {
    if (event.type === 'status') {
      updateAssistant((message) => ({ ...message, status: event.message }))
      return
    }
    if (event.type === 'tool') {
      updateAssistant((message) => ({
        ...message,
        tools: [...(message.tools ?? []), event.tool],
      }))
      return
    }
    if (event.type === 'text') {
      updateAssistant((message) => ({
        ...message,
        content: message.content + event.delta,
        status: undefined,
      }))
      return
    }
    updateAssistant((message) => ({
      ...message,
      error: event.message,
      status: undefined,
    }))
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    const userHistory: Msg[] = [...messages, { role: 'user', content: trimmed }]
    setMessages([
      ...userHistory,
      { role: 'assistant', content: '', status: 'Thinking…' },
    ])
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
          messages: userHistory.map(({ role, content }) => ({ role, content })),
        }),
      })
      if (!res.ok || !res.body) throw new Error(`Copilot request failed (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const consumeLine = (line: string) => {
        if (!line.trim()) return
        applyEvent(JSON.parse(line) as CopilotStreamEvent)
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) consumeLine(line)
      }
      buffer += decoder.decode()
      if (buffer.trim()) consumeLine(buffer)
    } catch (err) {
      updateAssistant((message) => ({
        ...message,
        status: undefined,
        error: err instanceof Error ? err.message : 'Copilot is unavailable right now.',
      }))
    } finally {
      setStreaming(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Close Scour agent' : 'Open Scour agent'}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-accent/40 bg-bg-elevated px-4 py-2.5 text-sm font-semibold text-accent-strong shadow-lg shadow-black/30 transition-colors hover:bg-bg-hover"
      >
        <span aria-hidden>✦</span>
        Ask Scour
      </button>

      {open && (
        <section
          aria-label="Scour shopping agent"
          className="fixed bottom-20 right-5 z-40 flex h-[min(38rem,calc(100dvh-6.5rem))] w-[min(27rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-card shadow-2xl shadow-black/40"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-fg">Scour Agent</span>
              <span className="font-mono text-[10px] text-fg-subtle">
                MCP-powered multi-store shopping
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-md px-2 py-1 text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
            >
              ✕
            </button>
          </div>

          <div
            ref={scrollRef}
            aria-live="polite"
            className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-fg-muted">
                  {query ? (
                    <>
                      Ask about the results for <span className="text-fg">“{query}”</span>, or
                      have me run a new search.
                    </>
                  ) : (
                    'Tell me what you need. I can search stores, compare prices, find cheaper offers, or plan a shopping mission.'
                  )}
                </p>
                <div className="flex flex-col gap-1.5">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-left text-[12px] text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <MessageBubble key={index} message={message} />
              ))
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void send(input)
            }}
            className="flex items-center gap-2 border-t border-border px-3 py-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={2000}
              placeholder="Find a product or ask a question…"
              className="min-w-0 flex-1 rounded-lg border border-border-strong bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-strong disabled:opacity-40"
            >
              {streaming ? '…' : 'Send'}
            </button>
          </form>
        </section>
      )}
    </>
  )
}

function MessageBubble({ message }: { message: Msg }) {
  if (message.role === 'user') {
    return (
      <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-accent px-3 py-2 text-[13px] leading-relaxed text-bg">
        {message.content}
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 self-start">
      {(message.content || message.status || (!message.error && !message.tools?.length)) && (
        <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl border border-border bg-bg-elevated px-3 py-2 text-[13px] leading-relaxed text-fg">
          {message.content || (
            <span className="inline-flex items-center gap-2 text-fg-subtle">
              <span className="inline-flex gap-1">
                <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
              </span>
              {message.status}
            </span>
          )}
        </div>
      )}
      {message.tools?.map((tool, index) => (
        <ToolResult key={`${tool.name}-${index}`} tool={tool} />
      ))}
      {message.error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
          {message.error}
        </div>
      )}
    </div>
  )
}

function ToolResult({ tool }: { tool: CopilotToolPresentation }) {
  return (
    <div className="overflow-hidden rounded-xl border border-accent/30 bg-bg">
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
            MCP · {tool.name.replaceAll('_', ' ')}
          </div>
          <div className="truncate text-xs font-semibold text-fg">{tool.label}</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-fg-muted">
            {tool.summary}
          </div>
        </div>
        {tool.href && (
          <a
            href={tool.href}
            className="shrink-0 font-mono text-[10px] text-accent hover:underline"
          >
            view all →
          </a>
        )}
      </div>
      {tool.products.length > 0 && (
        <div className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto">
          {tool.products.map((product) => (
            <a
              key={`${product.store}-${product.url}`}
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex gap-3 p-2.5 transition-colors hover:bg-bg-hover"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-elevated">
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.imageUrl}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-fg-subtle" aria-hidden>◇</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-xs font-medium leading-snug text-fg group-hover:text-accent-strong">
                  {product.title}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px]">
                  <span className="truncate text-fg-muted">{product.store}</span>
                  <span className="shrink-0 font-bold text-fg">{product.price}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function Dot({ delay = '0ms' }: { delay?: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle"
      style={{ animationDelay: delay }}
    />
  )
}
