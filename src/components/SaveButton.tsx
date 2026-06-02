'use client'

import { useState, useTransition } from 'react'
import { saveProduct, unsaveProduct } from '@/app/wishlist/actions'

// Heart toggle for pinning a clustered product to the wishlist. Optimistic:
// flips immediately and reverts if the server action throws. Stops event
// propagation because product cards are wrapped in retailer deep-links.
export function SaveButton({
  productId,
  initialSaved,
  size = 15,
}: {
  productId: string
  initialSaved: boolean
  size?: number
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [pending, startTransition] = useTransition()

  function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !saved
    setSaved(next)
    startTransition(async () => {
      try {
        if (next) await saveProduct(productId)
        else await unsaveProduct(productId)
      } catch {
        setSaved(!next)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      title={saved ? 'Saved — click to remove' : 'Save to wishlist'}
      className={`shrink-0 transition-colors disabled:opacity-50 ${
        saved ? 'text-accent' : 'text-fg-subtle hover:text-accent'
      }`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}
