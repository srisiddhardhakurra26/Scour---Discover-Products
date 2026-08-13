import { MissionResults } from '@/components/MissionResults'
import { runMission } from '@/lib/mission'

export async function MissionSearchResults({ query }: { query: string }) {
  const result = await runMission(query)
  return <MissionResults result={result} />
}

export function MissionSearchLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Planning shopping goal">
      <div className="rounded-2xl border border-border bg-bg-card p-5">
        <div className="mb-4 h-3 w-28 animate-pulse rounded bg-accent/30" />
        <div className="mb-5 h-6 w-2/3 animate-pulse rounded bg-bg-elevated" />
        <div className="grid gap-2 md:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-lg bg-bg-elevated" />
          ))}
        </div>
      </div>
      <p className="font-mono text-xs text-fg-muted">
        planning categories → searching stores → assembling complete packages
      </p>
    </div>
  )
}
