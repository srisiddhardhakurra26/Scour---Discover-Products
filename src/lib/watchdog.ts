import { prisma } from './db'
import { runCanary } from './health'

// Scheduled wrapper around the canary (src/lib/health.ts): probe every
// agent-onboarded source, let the canary repair/flag as it already does,
// and persist each outcome as a SourceHealth row so /sources can show a
// health history ("broke Tuesday, self-repaired Wednesday") instead of only
// the latest error. Scheduled daily from instrumentation-node.ts.

const HISTORY_KEEP = 30

export async function runWatchdog(): Promise<void> {
  const started = Date.now()
  console.log('[watchdog] probing sources…')
  const reports = await runCanary()

  for (const r of reports) {
    await prisma.sourceHealth.create({
      data: {
        retailerId: r.retailerId,
        status: r.status,
        query: r.query,
        count: r.count,
        detail: r.detail,
      },
    })
    // Keep a bounded history per source.
    const stale = await prisma.sourceHealth.findMany({
      where: { retailerId: r.retailerId },
      orderBy: { checkedAt: 'desc' },
      skip: HISTORY_KEEP,
      select: { id: true },
    })
    if (stale.length > 0) {
      await prisma.sourceHealth.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      })
    }
  }

  const summary = reports.map((r) => `${r.label}=${r.status}`).join(' ')
  console.log(
    `[watchdog] ${reports.length} sources in ${Math.round((Date.now() - started) / 1000)}s: ${summary}`,
  )
}
