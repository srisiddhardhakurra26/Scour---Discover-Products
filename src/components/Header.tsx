import Link from 'next/link'
import { Brand } from './Brand'

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6">
        <Brand />
        <div className="flex flex-1 items-center justify-end gap-1">
          {children}
          <Link
            href="/sources"
            className="rounded-md px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            Sources
          </Link>
        </div>
      </div>
    </header>
  )
}
