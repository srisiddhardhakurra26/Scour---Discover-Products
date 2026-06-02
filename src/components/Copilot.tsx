'use client'

import { useEffect, useRef, useState } from 'react'

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'Which of these is the best deal?',
  'Compare the top two.',
  'Which store is cheapest overall?',
]

// Floating, grounded shopping assistant. Streams plain text from /api/copilot,
// which injects the current query's compared products as context. Lives only on
// the search page (rendered when there's a query) so it always has something to
// talk about.
export function Copilot({ query }: { query: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, open])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    const next: Msg[] = [...messages, { role: 'user', content: trimmed }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, messages: next }),
      })
      if (!res.body) throw new Error('no stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        setMessages((m) => {
          const copy = [...m]
          const lastIdx = copy.length - 1
          copy[lastIdx] = { role: 'assistant', content: copy[lastIdx].content + chunk }
          return copy
        })
      }
    } catch {
      setMessages((m) => {
        const copy = [...m]
        copy[copy.length - 1] = {
          role: 'assistant',
          content: 'Copilot is unavailable right now. Search still works.',
        }
        return copy
      })
    } finally {
      setStreaming(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close Copilot' : 'Open Copilot'}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-accent/40 bg-bg-elevated px-4 py-2.5 text-sm font-semibold text-accent-strong shadow-lg shadow-black/30 transition-colors hover:bg-bg-hover"
      >
        <span aria-hidden>✦</span>
        Copilot
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[30rem] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-card shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-fg">Scour Copilot</span>
              <span className="font-mono text-[10px] text-fg-subtle">
                grounded in your current results
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

          <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-fg-muted">
                  Ask me about the products Scour found for{' '}
                  <span className="text-fg">{query ? `"${query}"` : 'your search'}</span>.
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-left text-[12px] text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'self-end bg-accent text-bg'
                      : 'self-start border border-border bg-bg-elevated text-fg'
                  }`}
                >
                  {m.content || (
                    <span className="inline-flex gap-1 text-fg-subtle">
                      <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
            className="flex items-center gap-2 border-t border-border px-3 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about these results…"
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
        </div>
      )}
    </>
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
