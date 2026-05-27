'use client'

import { useActionState, useEffect, useRef } from 'react'
import { addStoreRetailer } from './actions'

export function AddSourceForm() {
  const [state, formAction, pending] = useActionState(addStoreRetailer, null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="domain"
          required
          placeholder="storefront domain (e.g. allbirds.com)"
          className="flex-1 rounded-lg border border-border-strong bg-bg-card px-3 py-2 text-sm font-medium placeholder:font-normal placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
        <input
          name="label"
          placeholder="optional label"
          className="rounded-lg border border-border-strong bg-bg-card px-3 py-2 text-sm font-medium placeholder:font-normal placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring sm:w-48"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-accent-strong disabled:opacity-50"
        >
          {pending ? 'Checking…' : 'Add'}
        </button>
      </div>
      <p className="font-mono text-[11px] text-fg-subtle">
        Scour auto-detects Shopify (<code>/products.json</code>) and WooCommerce
        (<code>/wp-json/wc/store/v1/products</code>). Cloudflare-protected storefronts will
        be rejected.
      </p>
      {state?.error && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          Source added.
        </p>
      )}
    </form>
  )
}
