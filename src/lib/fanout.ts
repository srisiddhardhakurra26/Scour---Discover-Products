import { cache } from 'react'
import { after } from 'next/server'
import { prisma } from '@/lib/db'
import type { Adapter, NormalizedListing } from '@/lib/adapters/types'
import { persistListings, recordAdapterError } from '@/lib/persist'
import {
  materialGate,
  rankByRelevance,
  recallModeForType,
  type RankedListing,
} from '@/lib/relevance'
import { parseQuery } from '@/lib/llm/query-parser'
import { reformulateForStore } from '@/lib/llm/requery'
import { withHardTimeout } from '@/lib/timeout'

// When a live fetch fails (timeout, bot-block), serve the retailer's
// recently-persisted listings instead of dropping it from the page — the
// scrapers are flaky, and without this the same query shows a different set
// of stores on every visit. A day-old price labeled "cached" beats the store
// silently vanishing: the deep link shows the live price anyway, and the
// next successful fetch refreshes everything.
const FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000
const FALLBACK_MAX_ROWS = 80

export type AdapterSearchResult = {
  adapter: Adapter
  kept: RankedListing[]
  rawCount: number
  elapsedMs: number
  failed: boolean
  /** True when served from recently-persisted listings after a failed fetch. */
  fromCache: boolean
}

// One in-flight search per adapter per request. AllResultsView, the per-source
// AdapterSections, and ClusteredProductsSection all await the same promises,
// so each adapter is searched — and its results persisted — exactly once per
// request, and every section sees the same final state. This replaces the old
// model where the clusters section polled the DB and raced the other sections'
// writes, surfacing different clusters run to run for the same query.
const inFlight = cache(() => new Map<string, Promise<AdapterSearchResult>>())

export function searchAdapter(
  adapter: Adapter,
  query: string,
  timeoutMs: number,
): Promise<AdapterSearchResult> {
  const pool = inFlight()
  const hit = pool.get(adapter.id)
  if (hit) return hit
  const promise = run(adapter, query, timeoutMs)
  pool.set(adapter.id, promise)
  return promise
}

/** Fan out across all adapters; resolves when every search has settled. */
export function searchAllAdapters(
  adapters: Adapter[],
  query: string,
  timeoutMs: number,
): Promise<AdapterSearchResult[]> {
  return Promise.all(adapters.map((a) => searchAdapter(a, query, timeoutMs)))
}

async function run(
  adapter: Adapter,
  query: string,
  timeoutMs: number,
): Promise<AdapterSearchResult> {
  const started = performance.now()
  const parsed = await parseQuery(query)
  try {
    const searchQuery = parsed.refinedQuery || query
    // Hard ceiling on top of the AbortSignal: some adapters don't honor abort
    // and would otherwise hang every section awaiting this promise.
    const raw = await withHardTimeout(
      adapter.search(searchQuery, AbortSignal.timeout(timeoutMs)),
      timeoutMs + 1500,
      `${adapter.label} search`,
    )
    let ranked = await rankByRelevance(query, raw, parsed, recallModeForType(adapter.type))
    // Demanded materials are mandatory (deterministic twin of the judge's
    // rule) — applied here so every view, persist, and the clusters section
    // see the same gated set.
    ranked.kept = materialGate(query, parsed, ranked.kept)

    // Agentic re-query: a store that kept nothing gets one retry with a
    // query reformulated in its own vocabulary ("leather shoes" → "chelsea
    // boot" at a boot brand). Results are still ranked against the user's
    // original query, so intent can't drift. LLM-down or no suggestion →
    // we simply keep the empty first pass.
    if (ranked.kept.length === 0 && adapter.type !== 'mock') {
      const alt = await reformulateForStore(query, adapter.label, adapter.type)
      if (alt && alt !== searchQuery.toLowerCase()) {
        try {
          const altRaw = await withHardTimeout(
            adapter.search(alt, AbortSignal.timeout(timeoutMs)),
            timeoutMs + 1500,
            `${adapter.label} re-query`,
          )
          const altRanked = await rankByRelevance(
            query,
            altRaw,
            parsed,
            recallModeForType(adapter.type),
          )
          altRanked.kept = materialGate(query, parsed, altRanked.kept)
          if (altRanked.kept.length > 0) {
            console.log(
              `[requery] ${adapter.label}: "${alt}" rescued ${altRanked.kept.length} listings`,
            )
            ranked = altRanked
          }
        } catch (err) {
          console.warn(
            `[requery] ${adapter.label} retry failed:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
    }
    // Persist before resolving (not via after()) so ClusteredProductsSection,
    // which awaits this same promise, sees the writes and the clusters built
    // from them.
    try {
      await persistListings(
        adapter.id,
        ranked.kept.map((r) => r.listing),
        ranked.kept.map((r) => r.embedding),
      )
    } catch (err) {
      console.error(`[persist] ${adapter.label}:`, err)
    }
    return {
      adapter,
      kept: ranked.kept,
      rawCount: raw.length,
      elapsedMs: Math.round(performance.now() - started),
      failed: false,
      fromCache: false,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    after(() => recordAdapterError(adapter.id, message).catch(() => {}))
    // warn, not error: adapter failures are routine (bot-blocks, timeouts) and
    // already recorded to the retailer row for /sources. console.error here
    // makes the Next dev overlay flash errors on every search.
    console.warn(`[adapter] ${adapter.label}: ${message}`)

    // Fallback: rank this retailer's recently-seen listings through the same
    // pipeline, so a flaky fetch doesn't flip the store in and out of the
    // results between visits.
    try {
      const cached = await loadRecentListings(adapter.id)
      if (cached.length > 0) {
        const ranked = await rankByRelevance(
          query,
          cached,
          parsed,
          recallModeForType(adapter.type),
        )
        ranked.kept = materialGate(query, parsed, ranked.kept)
        if (ranked.kept.length > 0) {
          return {
            adapter,
            kept: ranked.kept,
            rawCount: cached.length,
            elapsedMs: Math.round(performance.now() - started),
            failed: false,
            fromCache: true,
          }
        }
      }
    } catch (fallbackErr) {
      console.warn(`[fallback] ${adapter.label}:`, fallbackErr)
    }

    return {
      adapter,
      kept: [],
      rawCount: 0,
      elapsedMs: Math.round(performance.now() - started),
      failed: true,
      fromCache: false,
    }
  }
}

async function loadRecentListings(retailerId: string): Promise<NormalizedListing[]> {
  const rows = await prisma.listing.findMany({
    where: {
      retailerId,
      lastSeenAt: { gte: new Date(Date.now() - FALLBACK_MAX_AGE_MS) },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: FALLBACK_MAX_ROWS,
  })
  return rows.map((r) => ({
    externalId: r.externalId,
    title: r.title,
    url: r.url,
    imageUrl: r.imageUrl ?? undefined,
    priceMinor: r.priceMinor,
    currency: r.currency,
    shippingMinor: r.shippingMinor ?? undefined,
    availability: (r.availability as NormalizedListing['availability']) ?? undefined,
    sellerName: r.sellerName ?? undefined,
    sellerRating: r.sellerRating ?? undefined,
    reviewCount: r.reviewCount ?? undefined,
    reviewAvg: r.reviewAvg ?? undefined,
    // OCR'd image text rides along as judge evidence ("256GB", "wireless")
    // that bare titles never state.
    detailsText:
      [r.detailsText, r.ocrText].filter(Boolean).join('\n') || undefined,
  }))
}
