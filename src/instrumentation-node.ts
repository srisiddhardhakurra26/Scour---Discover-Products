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
