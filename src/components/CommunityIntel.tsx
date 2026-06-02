'use client'

import { useState } from 'react'
import { getProductIntel, type IntelResponse } from '@/app/search/actions'
import type { Verdict } from '@/lib/llm/product-intel'

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  positive: { label: 'liked', className: 'bg-success/15 text-success' },
  mixed: { label: 'mixed', className: 'bg-warn/15 text-warn' },
  negative: { label: 'panned', className: 'bg-danger/15 text-danger' },
  unknown: { label: 'no signal', className: 'bg-bg-elevated text-fg-subtle' },
}

// On-demand community sentiment for a clustered product. Lazily fetches from the
// getProductIntel server action the first time it's opened, then caches the
// result locally so re-opening is instant.
export function CommunityIntel({ productTitle }: { productTitle: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<IntelResponse | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !data && !loading) {
      setLoading(true)
      try {
        setData(await getProductIntel(productTitle))
      } catch {
        setData({ intel: null, sources: 0, error: 'Could not load community intel.' })
      } finally {
        setLoading(false)
      }
    }
  }

  const verdict = data?.intel?.verdict
  const style = verdict ? VERDICT_STYLE[verdict] : null

  return (
    <div className="flex flex-col gap-2 border-t border-border/50 pt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-subtle transition-colors hover:text-accent"
      >
        <span className="flex items-center gap-1.5">
          <span>community intel</span>
          {style && (
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${style.className}`}>
              {style.label}
            </span>
          )}
        </span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 text-[11px] leading-relaxed">
          {loading && <p className="font-mono text-fg-subtle">Reading the forums…</p>}

          {!loading && data?.error && (
            <p className="font-mono text-fg-subtle">{data.error}</p>
          )}

          {!loading && data?.intel && (
            <>
              <p className="text-fg-muted">{data.intel.summary}</p>

              {data.intel.pros.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {data.intel.pros.map((p, i) => (
                    <li key={i} className="flex gap-1.5 text-fg-muted">
                      <span className="text-success">+</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}

              {data.intel.cons.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {data.intel.cons.map((c, i) => (
                    <li key={i} className="flex gap-1.5 text-fg-muted">
                      <span className="text-danger">−</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}

              {data.intel.dealTip && (
                <p className="rounded-md border border-accent/20 bg-accent-soft px-2 py-1 text-accent-strong">
                  💡 {data.intel.dealTip}
                </p>
              )}

              {data.sources > 0 && (
                <p className="font-mono text-[9px] text-fg-subtle">
                  from {data.sources} discussion{data.sources === 1 ? '' : 's'}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
