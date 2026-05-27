'use client'

import { useEffect, useRef, useState } from 'react'

export function CardRail({
  children,
  itemMinWidth = 220,
  scrollByCount = 3,
}: {
  children: React.ReactNode
  itemMinWidth?: number
  scrollByCount?: number
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const check = () => {
      setCanLeft(el.scrollLeft > 2)
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [])

  const scroll = (dir: 1 | -1) => {
    const el = railRef.current
    if (!el) return
    el.scrollBy({ left: dir * (itemMinWidth + 12) * scrollByCount, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      <div
        ref={railRef}
        className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {/* Edge fades hint that there's more to the left/right */}
      <div
        aria-hidden
        className={`pointer-events-none absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-bg via-bg/70 to-transparent transition-opacity duration-200 ${canLeft ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-bg via-bg/70 to-transparent transition-opacity duration-200 ${canRight ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Scroll arrows — hidden when can't scroll that direction */}
      <ScrollButton
        direction="left"
        visible={canLeft}
        onClick={() => scroll(-1)}
      />
      <ScrollButton
        direction="right"
        visible={canRight}
        onClick={() => scroll(1)}
      />
    </div>
  )
}

function ScrollButton({
  direction,
  visible,
  onClick,
}: {
  direction: 'left' | 'right'
  visible: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={direction === 'left' ? 'Scroll left' : 'Scroll right'}
      onClick={onClick}
      tabIndex={visible ? 0 : -1}
      className={`group absolute top-1/2 -translate-y-1/2 ${direction === 'left' ? 'left-1' : 'right-1'} z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border-strong bg-bg-card/90 text-fg-muted shadow-lg backdrop-blur-md transition-all hover:border-accent/60 hover:bg-bg-elevated hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent-ring ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className={direction === 'left' ? 'rotate-180' : ''}
        aria-hidden
      >
        <path
          d="M5 2 L10 7 L5 12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
