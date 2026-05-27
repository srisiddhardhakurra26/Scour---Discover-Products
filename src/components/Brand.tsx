import Link from 'next/link'

export function BrandMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden
      className={`${className} text-accent`}
    >
      <circle cx="42" cy="42" r="22" stroke="currentColor" strokeWidth="9" />
      <circle cx="42" cy="42" r="5" fill="currentColor" />
      <line
        x1="60"
        y1="60"
        x2="82"
        y2="82"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Brand({ asLink = true }: { asLink?: boolean }) {
  const content = (
    <span className="inline-flex items-baseline gap-2">
      <span className="inline-flex translate-y-[2px] items-center">
        <BrandMark className="h-[18px] w-[18px]" />
      </span>
      <span className="text-[19px] font-bold tracking-tight text-fg">
        scour
      </span>
    </span>
  )
  if (!asLink) return content
  return (
    <Link
      href="/"
      className="group inline-flex items-center transition-opacity hover:opacity-80"
      aria-label="Scour home"
    >
      {content}
    </Link>
  )
}
