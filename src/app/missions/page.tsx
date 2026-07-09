import { Header } from '@/components/Header'
import { MissionRunner } from '@/components/MissionRunner'

export const dynamic = 'force-dynamic'

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>
}) {
  const sp = await searchParams
  const initial = (sp.m ?? '').trim()

  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10 sm:py-14">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-accent">
            Agent
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Shopping missions
          </h1>
          <p className="max-w-xl text-base text-fg-muted">
            Describe a goal in plain English. Scour plans 2–5 product searches, fans them out
            across every store, and returns a ranked shortlist with deep links.
          </p>
        </div>
        <MissionRunner initialMission={initial} />
      </main>
    </>
  )
}
