export function SearchBar({
  defaultValue = '',
  size = 'md',
  placeholder = 'Search across every store…',
}: {
  defaultValue?: string
  size?: 'sm' | 'md' | 'lg'
  placeholder?: string
}) {
  const sizeCls =
    size === 'lg'
      ? 'h-14 text-lg px-5'
      : size === 'sm'
        ? 'h-9 text-sm px-3'
        : 'h-11 text-[15px] px-4'

  return (
    <form action="/search" method="get" className="group relative w-full">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-fg-subtle transition-colors group-focus-within:text-accent">
        <svg
          width="18"
          height="18"
          viewBox="0 0 100 100"
          fill="none"
          aria-hidden
        >
          <circle cx="42" cy="42" r="22" stroke="currentColor" strokeWidth="9" />
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
      </div>
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={size === 'lg'}
        className={`w-full rounded-xl border border-border-strong bg-bg-card pl-12 pr-24 ${sizeCls} font-medium text-fg outline-none transition-all placeholder:font-normal placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent-ring`}
      />
      <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-fg-subtle group-focus-within:opacity-0 transition-opacity">
        <kbd className="rounded border border-border bg-bg px-1.5 py-[2px] font-mono text-[10px] font-medium">
          ⌘K
        </kbd>
      </div>
    </form>
  )
}
