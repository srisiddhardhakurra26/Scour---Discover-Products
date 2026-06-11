// Server-start warmups. Node runtime only — loaded conditionally from
// instrumentation.ts so the Edge compile never sees prisma/sqlite imports.
// Both warmups are fire-and-forget: boot must never block on them, and their
// failures are caught (the search path has fallbacks for both).
export function warmup() {
  // Warm the local embedding model. Loading it lazily on the first search
  // adds seconds of latency, which used to push that search's persists past
  // the cluster section's window and skew its first results.
  import('./lib/embeddings')
    .then((m) => m.embedText('warmup'))
    .catch((err) => console.warn('[instrumentation] embedder warmup failed:', err))

  // Prewarm Shopify catalogs so the first search of a session doesn't race a
  // cold catalog fetch against the adapter timeout — the cold-start cause of
  // "store missing from the first search".
  warmShopifyCatalogs().catch((err) =>
    console.warn('[instrumentation] catalog prewarm failed:', err),
  )

  scheduleWatchdog()
}

// Daily source watchdog: probes agent-onboarded sources, auto-repairs stale
// selectors, and persists a health history for /sources. Delayed past boot so
// it never competes with first-search warmup; unref'd so it never holds the
// process open. WATCHDOG_DISABLED=1 turns it off, WATCHDOG_INTERVAL_MS tunes.
const WATCHDOG_INITIAL_DELAY_MS = 5 * 60_000

function scheduleWatchdog() {
  if (process.env.WATCHDOG_DISABLED) return
  // Dev hot-reload re-runs warmup; arm the timers once per process.
  const g = globalThis as { __scourWatchdogArmed?: boolean }
  if (g.__scourWatchdogArmed) return
  g.__scourWatchdogArmed = true

  const intervalMs = Number(process.env.WATCHDOG_INTERVAL_MS) || 24 * 60 * 60_000
  const run = () =>
    import('./lib/watchdog')
      .then((m) => m.runWatchdog())
      .catch((err) => console.warn('[watchdog]', err instanceof Error ? err.message : err))
  setTimeout(run, WATCHDOG_INITIAL_DELAY_MS).unref()
  setInterval(run, intervalMs).unref()
}

async function warmShopifyCatalogs() {
  const { prisma } = await import('./lib/db')
  const { prewarmShopifyCatalog } = await import('./lib/adapters/shopify')
  const stores = await prisma.retailer.findMany({
    where: { type: 'shopify', enabled: true },
    select: { identifier: true, label: true },
  })
  await Promise.all(
    stores.map((s) =>
      prewarmShopifyCatalog(s.identifier, s.label ?? s.identifier)
        .then((n) => console.log(`[instrumentation] prewarmed ${s.identifier} (${n} products)`))
        .catch((err) =>
          console.warn(
            `[instrumentation] prewarm ${s.identifier} failed:`,
            err instanceof Error ? err.message : err,
          ),
        ),
    ),
  )
}
