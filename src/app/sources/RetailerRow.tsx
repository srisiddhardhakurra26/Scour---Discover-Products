'use client'

import { useTransition } from 'react'
import { removeRetailer, toggleRetailer } from './actions'

const USER_REMOVABLE_TYPES = new Set(['shopify', 'woocommerce'])

export function RetailerRow({
  id,
  type,
  label,
  identifier,
  enabled,
}: {
  id: string
  type: string
  label: string
  identifier: string
  enabled: boolean
}) {
  const [pending, startTransition] = useTransition()
  const canRemove = USER_REMOVABLE_TYPES.has(type)

  const link =
    type === 'shopify' || type === 'woocommerce'
      ? `https://${identifier}`
      : type === 'reddit'
        ? `https://www.reddit.com/r/${identifier}`
        : null

  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-card px-4 py-3 transition-colors hover:border-border-strong">
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
      <div className="flex shrink-0 items-center gap-2">
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
