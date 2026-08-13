'use client'

import { useState } from 'react'
import { MissionResults } from '@/components/MissionResults'
import type { MissionResult } from '@/lib/mission'

const EXAMPLES = [
  'gift for dad under $50 who likes coffee',
  'furnish a home office under $500',
  'apartment starter kitchen kit under $300',
  'build a coffee setup under $250',
]

export function MissionRunner({ initialMission = '' }: { initialMission?: string }) {
  const [mission, setMission] = useState(initialMission)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MissionResult | null>(null)

  async function run(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setMission(trimmed)
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      let res: Response | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch('/api/mission', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mission: trimmed }),
          })
          break
        } catch (err) {
          if (attempt === 1) throw err
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
      }
      if (!res) throw new Error('Mission request did not start.')
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Request failed (${res.status})`)
      }
      setResult((await res.json()) as MissionResult)
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'The connection dropped while Scour was searching. Please try again.'
          : err instanceof Error
            ? err.message
            : 'Mission failed.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void run(mission)
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-fg">Describe the mission</span>
          <textarea
            value={mission}
            onChange={(event) => setMission(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. furnish a home office under $500"
            className="w-full resize-y rounded-xl border border-border-strong bg-bg-card px-4 py-3 text-[15px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent-ring"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading || !mission.trim()}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? 'Scouring stores…' : 'Run mission'}
          </button>
          {loading && (
            <span className="font-mono text-[11px] text-fg-subtle">
              planning → searching each category → building packages
            </span>
          )}
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-fg-subtle">try</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={loading}
            onClick={() => void run(example)}
            className="rounded-full border border-border bg-bg-card px-3 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {result && <MissionResults result={result} />}
    </div>
  )
}
