'use client'

import { useState, useTransition } from 'react'
import {
  diagnoseRetailer,
  removeRetailer,
  repairRetailer,
  toggleRetailer,
  type DiagnoseResult,
} from './actions'

const USER_REMOVABLE_TYPES = new Set(['shopify', 'woocommerce', 'generic-html'])
const AGENT_REPAIRABLE_TYPES = new Set(['generic-html'])

type HealthDot = { status: string; label: string }

// Watchdog statuses → dot colors. 'repaired' is green on purpose: the source
// broke and healed itself, which is the system working.
const DOT_COLOR: Record<string, string> = {
  ok: 'bg-success',
  repaired: 'bg-success',
  blocked: 'bg-warn',
  empty: 'bg-fg-subtle',
  unreachable: 'bg-warn',
  stale: 'bg-danger',
  'repair-failed': 'bg-danger',
  'config-error': 'bg-danger',
}

export function RetailerRow({
  id,
  type,
  label,
  identifier,
  enabled,
  lastFetchedLabel,
  lastError,
  configSummary,
  healthHistory = [],
}: {
  id: string
  type: string
  label: string
  identifier: string
  enabled: boolean
  lastFetchedLabel: string | null
  lastError: string | null
  configSummary: string | null
  healthHistory?: HealthDot[]
}) {
  const [pending, startTransition] = useTransition()
  const [repairing, startRepair] = useTransition()
  const [open, setOpen] = useState(false)
  const [sample, setSample] = useState('shirt')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<DiagnoseResult | null>(null)
  const [repairStatus, setRepairStatus] = useState<string | null>(null)

  const canRemove = USER_REMOVABLE_TYPES.has(type)
  const canRepair = AGENT_REPAIRABLE_TYPES.has(type)

  const health: 'ok' | 'error' | 'unknown' = lastError
    ? 'error'
    : lastFetchedLabel
      ? 'ok'
      : 'unknown'
  const healthColor =
    health === 'error' ? 'bg-danger' : health === 'ok' ? 'bg-success' : 'bg-fg-subtle'
  const healthTitle = lastError
    ? `Error: ${lastError}`
    : lastFetchedLabel
      ? `Last fetched OK ${lastFetchedLabel}`
      : 'Never fetched'

  const link =
    type === 'shopify' || type === 'woocommerce' || type === 'generic-html'
      ? `https://${identifier}`
      : type === 'reddit'
        ? `https://www.reddit.com/r/${identifier}`
        : null

  async function handleTest() {
    if (!sample.trim() || testing) return
    setTesting(true)
    setResult(null)
    try {
      setResult(await diagnoseRetailer(id, sample.trim()))
    } finally {
      setTesting(false)
    }
  }

  function handleRepair() {
    if (!sample.trim()) {
      setRepairStatus('Enter a sample query first.')
      return
    }
    setRepairStatus('Running repair agent… (this can take ~30s)')
    startRepair(async () => {
      const r = await repairRetailer(id, sample.trim())
      setRepairStatus(r.ok ? 'Config updated — re-test to confirm.' : (r.error ?? 'Repair failed.'))
    })
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-bg-card px-4 py-3 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${healthColor}`}
            title={healthTitle}
            aria-label={healthTitle}
          />
          <div className="flex min-w-0 flex-col">
            <span className={`truncate font-medium ${enabled ? 'text-fg' : 'text-fg-muted'}`}>
              {label}
            </span>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-mono text-[11px] text-fg-subtle hover:text-accent hover:underline"
              >
                {identifier}
              </a>
            ) : (
              <span className="truncate font-mono text-[11px] text-fg-subtle">{identifier}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {lastFetchedLabel && !lastError && (
            <span className="hidden font-mono text-[10px] text-fg-subtle sm:inline">
              {lastFetchedLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              open
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'
            }`}
          >
            Console
          </button>
          <Toggle
            checked={enabled}
            disabled={pending}
            onChange={(v) => startTransition(() => toggleRetailer(id, v))}
          />
          {canRemove ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm(`Remove ${label}?`)) startTransition(() => removeRetailer(id))
              }}
              className="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
            >
              Remove
            </button>
          ) : (
            <span className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
              built-in
            </span>
          )}
        </div>
      </div>

      {lastError && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-danger/90">
          {lastError}
        </p>
      )}

      {healthHistory.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            watchdog
          </span>
          <div className="flex items-center gap-1">
            {healthHistory.map((h, i) => (
              <span
                key={i}
                title={h.label}
                className={`h-1.5 w-1.5 rounded-full ${DOT_COLOR[h.status] ?? 'bg-fg-subtle'}`}
              />
            ))}
          </div>
          {healthHistory[healthHistory.length - 1]?.status === 'blocked' && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-warn">
              blocked by bot protection
            </span>
          )}
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-bg px-3 py-3">
          <div className="flex flex-col gap-1 font-mono text-[10px] text-fg-subtle">
            <span>
              status:{' '}
              <span
                className={
                  health === 'error'
                    ? 'text-danger'
                    : health === 'ok'
                      ? 'text-success'
                      : 'text-fg-muted'
                }
              >
                {health === 'error' ? 'error' : health === 'ok' ? 'healthy' : 'never fetched'}
              </span>
              {lastFetchedLabel && ` · last fetched ${lastFetchedLabel}`}
            </span>
            {configSummary && (
              <span className="truncate">
                search url: <span className="text-fg-muted">{configSummary}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTest()
              }}
              placeholder="sample query (e.g. shirt)"
              className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg-card px-2.5 py-1.5 text-xs placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
            />
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-bg transition-colors hover:bg-accent-strong disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test'}
            </button>
            {canRepair && (
              <button
                type="button"
                onClick={handleRepair}
                disabled={repairing}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent disabled:opacity-50"
              >
                {repairing ? 'Repairing…' : 'Repair'}
              </button>
            )}
          </div>

          {result && (
            <div className="flex flex-col gap-1.5 font-mono text-[11px]">
              {result.ok ? (
                <>
                  <span
                    className={result.count && result.count > 0 ? 'text-success' : 'text-warn'}
                  >
                    {result.count} listing{result.count === 1 ? '' : 's'} · {result.elapsedMs}ms
                    {result.count === 0 && ' — source returned nothing for this query'}
                  </span>
                  {result.samples?.map((s, i) => (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-baseline justify-between gap-2 text-fg-muted hover:text-accent"
                    >
                      <span className="truncate">{s.title}</span>
                      <span className="shrink-0 tabular-nums">{s.price}</span>
                    </a>
                  ))}
                </>
              ) : (
                <span className="text-danger">
                  {result.error}
                  {result.elapsedMs ? ` · ${result.elapsedMs}ms` : ''}
                </span>
              )}
            </div>
          )}

          {repairStatus && (
            <p className="font-mono text-[11px] text-fg-subtle">{repairStatus}</p>
          )}
        </div>
      )}
    </li>
  )
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full border transition-colors disabled:opacity-50 ${
        checked
          ? 'border-accent/60 bg-accent/30'
          : 'border-border-strong bg-bg-elevated'
      }`}
    >
      <span
        className={`absolute top-[1px] h-[15px] w-[15px] rounded-full transition-all ${
          checked ? 'left-[18px] bg-accent' : 'left-[1px] bg-fg-muted'
        }`}
      />
    </button>
  )
}
