'use client'

import { useState, useTransition } from 'react'
import { setAlert, unsaveProduct } from './actions'

// Target-price editor + remove control for a saved product. The target is just
// a stored threshold the dashboard highlights against; there's no background
// watcher (search is on-demand), so "set a target, see it flagged next visit".
export function WishlistControls({
  productId,
  alertBelowMinor,
}: {
  productId: string
  alertBelowMinor: number | null
}) {
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState(
    alertBelowMinor != null ? (alertBelowMinor / 100).toString() : '',
  )

  function saveAlert() {
    const trimmed = value.trim()
    if (trimmed === '') {
      startTransition(() => setAlert(productId, null))
      return
    }
    const minor = Math.round(parseFloat(trimmed) * 100)
    if (!Number.isFinite(minor) || minor < 0) return
    startTransition(() => setAlert(productId, minor))
  }

  return (
    <div className="flex items-center gap-2 border-t border-border/60 pt-2.5">
      <label className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
        target
      </label>
      <div className="flex items-center rounded-md border border-border-strong bg-bg-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-ring">
        <span className="pl-2 font-mono text-xs text-fg-subtle">$</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveAlert()
          }}
          inputMode="decimal"
          placeholder="—"
          className="w-16 bg-transparent px-1 py-1 text-xs tabular-nums focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={saveAlert}
        disabled={pending}
        className="rounded-md bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-bg transition-colors hover:bg-accent-strong disabled:opacity-50"
      >
        Set
      </button>
      <button
        type="button"
        onClick={() => startTransition(() => unsaveProduct(productId))}
        disabled={pending}
        className="ml-auto rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  )
}

// Minimal remove button for wishlist entries whose product no longer exists.
export function RemoveSaved({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      onClick={() => startTransition(() => unsaveProduct(productId))}
      disabled={pending}
      className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
    >
      Remove
    </button>
  )
}
