'use client'

import { useState } from 'react'
import { formatPrice } from '@/lib/format'

type MissionQuery = {
  q: string
  maxPriceMinor?: number
  minPriceMinor?: number
  reason: string
}

type MissionPlan = {
  summary: string
  recipient?: string
  occasion?: string
  budgetMaxMinor?: number
  budgetMinMinor?: number
  criteria: string[]
  queries: MissionQuery[]
}

type MissionPick = {
  title: string
  priceMinor: number
  currency: string
  store: string
  url: string
  imageUrl?: string
  query: string
  why: string
  rank: number
}

type MissionResult = {
  mission: string
  plan: MissionPlan
  picks: MissionPick[]
  candidatesConsidered: number
  storesSearched: number
  scourSearchUrls: { q: string; url: string }[]
}

const EXAMPLES = [
  'gift for dad under $50 who likes coffee',
  'apartment starter kitchen kit under $150',
  'quiet mechanical keyboard for office under $120',
  'running shoes under $100, wide toe box',
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
      const res = await fetch('/api/mission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mission: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Request failed (${res.status})`)
      }
      const data = (await res.json()) as MissionResult
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mission failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(mission)
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-fg">Describe the mission</span>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. gift for dad under $50 who likes coffee"
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
              planning → multi-store search → ranking picks
            </span>
          )}
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-fg-subtle">try</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={loading}
            onClick={() => void run(ex)}
            className="rounded-full border border-border bg-bg-card px-3 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-8">
          {/* Plan */}
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-accent-strong">
                Plan
              </h2>
              <span className="font-mono text-[11px] text-fg-subtle">
                {result.candidatesConsidered} candidates · {result.storesSearched} stores
              </span>
            </div>
            <p className="text-base font-medium text-fg">{result.plan.summary}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {result.plan.recipient && (
                <Chip label={`for ${result.plan.recipient}`} />
              )}
              {result.plan.occasion && <Chip label={result.plan.occasion} />}
              {result.plan.budgetMaxMinor != null && (
                <Chip
                  label={`budget ≤ ${formatPrice(result.plan.budgetMaxMinor, 'USD')}`}
                />
              )}
              {result.plan.criteria.map((c) => (
                <Chip key={c} label={c} muted />
              ))}
            </div>
            <ul className="flex flex-col gap-2">
              {result.plan.queries.map((q) => {
                const link = result.scourSearchUrls.find((s) => s.q.includes(q.q) || s.q === q.q)
                return (
                  <li
                    key={q.q}
                    className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{q.q}</div>
                      <div className="text-xs text-fg-muted">{q.reason}</div>
                    </div>
                    {link && (
                      <a
                        href={link.url}
                        className="shrink-0 font-mono text-[11px] text-accent hover:underline"
                      >
                        open search →
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Picks */}
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg">
              Shortlist
            </h2>
            {result.picks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-bg-card p-8 text-center text-sm text-fg-muted">
                No strong picks this run — try a more specific product type or raise the budget.
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {result.picks.map((p) => (
                  <li key={`${p.rank}-${p.url}`}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex gap-4 rounded-xl border border-border bg-bg-card p-3 transition-colors hover:border-border-strong hover:bg-bg-hover"
                    >
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-elevated">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imageUrl}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="font-mono text-lg text-fg-subtle">#{p.rank}</span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="line-clamp-2 text-sm font-semibold text-fg group-hover:text-accent-strong">
                            <span className="mr-2 font-mono text-xs text-accent">#{p.rank}</span>
                            {p.title}
                          </h3>
                          <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-fg">
                            {formatPrice(p.priceMinor, p.currency)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                          <span>{p.store}</span>
                          <span className="text-fg-subtle">·</span>
                          <span>via “{p.query}”</span>
                        </div>
                        <p className="text-xs leading-relaxed text-fg-muted">{p.why}</p>
                      </div>
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Chip({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? 'rounded-full border border-border bg-bg px-2.5 py-0.5 text-fg-muted'
          : 'rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-accent-strong'
      }
    >
      {label}
    </span>
  )
}
