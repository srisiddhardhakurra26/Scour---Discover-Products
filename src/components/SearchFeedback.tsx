'use client'

import { useState } from 'react'

export function SearchFeedback({
  query,
  searchRunId,
  resultKey,
}: {
  query: string
  searchRunId?: string | null
  resultKey?: string
}) {
  const [sent, setSent] = useState<'helpful' | 'not_helpful' | null>(null)

  async function send(verdict: 'helpful' | 'not_helpful') {
    setSent(verdict)
    try {
      const response = await fetch('/api/search-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, searchRunId, resultKey, verdict }),
      })
      if (!response.ok) throw new Error('feedback request failed')
    } catch {
      setSent(null)
    }
  }

  return (
    <div className="flex items-center gap-1 text-[10px] text-fg-subtle">
      <span>{sent ? 'Thanks — this improves Scour.' : 'Useful?'}</span>
      {!sent && (
        <>
          <button type="button" onClick={() => send('helpful')} className="rounded px-1.5 py-1 hover:bg-bg-hover hover:text-fg" aria-label="Useful result">
            yes
          </button>
          <button type="button" onClick={() => send('not_helpful')} className="rounded px-1.5 py-1 hover:bg-bg-hover hover:text-fg" aria-label="Not useful result">
            no
          </button>
        </>
      )}
    </div>
  )
}
