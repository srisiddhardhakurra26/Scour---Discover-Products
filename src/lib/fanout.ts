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
import type { ParsedQuery } from '@/lib/llm/query-parser'
import { reformulateForStore } from '@/lib/llm/requery'
import {
  adapterSearchKey,
  cachedListingsForQuery,
  dedupeListings,
} from '@/lib/result-quality'
import { withHardTimeout } from '@/lib/timeout'
import {
  recordSourceFailure,
  recordSourceSuccess,
  sourceCanAttempt,
} from '@/lib/source-reliability'
import { buildSearchSpec } from '@/lib/search-spec'
import { buildQueryVariants } from '@/lib/search-retrieval'

// When a live fetch fails (timeout, bot-block), serve the retailer's
// recently-persisted listings instead of dropping it from the page — the
// scrapers are flaky, and without this the same query shows a different set
// of stores on every visit. A day-old price labeled "cached" beats the store
// silently vanishing: the deep link shows the live price anyway, and the
// next successful fetch refreshes everything.
const FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000
const FALLBACK_MAX_ROWS = 80

function scheduleAfter(task: () => void | Promise<void>): void {
  try {
    after(task)
  } catch {
    // MCP/CLI callers can execute this module without a Next request context.
    void task()
  }
}

export type AdapterSearchResult = {
  adapter: Adapter
  kept: RankedListing[]
  rawCount: number
  elapsedMs: number
  failed: boolean
  /** True when served from recently-persisted listings after a failed fetch. */
  fromCache: boolean
}

type SearchOptions = {
  persist?: boolean
  parsedQuery?: ParsedQuery
  allowRequery?: boolean
}

// One in-flight search per adapter/mode per request. AllResultsView, the
// per-source AdapterSections, and ClusteredProductsSection all await the same
// persisted promises, so each adapter is searched exactly once per request
// and every section sees the same final state. Ephemeral consumers such as
// missions use a separate key because they intentionally skip persistence.
// This replaces the old
// model where the clusters section polled the DB and raced the other sections'
// writes, surfacing different clusters run to run for the same query.
const inFlight = cache(() => new Map<string, Promise<AdapterSearchResult>>())

export function searchAdapter(
  adapter: Adapter,
  query: string,
  timeoutMs: number,
  options?: SearchOptions,
): Promise<AdapterSearchResult> {
  const pool = inFlight()
  const persist = options?.persist !== false
  const allowRequery = options?.allowRequery !== false
  const key = `${adapterSearchKey(adapter.id, query)}:${persist ? 'persist' : 'ephemeral'}:${allowRequery ? 'retry' : 'once'}`
  const hit = pool.get(key)
  if (hit) return hit
  const promise = run(
    adapter,
    query,
    timeoutMs,
    persist,
    options?.parsedQuery,
    allowRequery,
  )
  pool.set(key, promise)
  return promise
}

/** Fan out across all adapters; resolves when every search has settled. */
export function searchAllAdapters(
  adapters: Adapter[],
  query: string,
  timeoutMs: number,
  options?: SearchOptions,
): Promise<AdapterSearchResult[]> {
  return Promise.all(adapters.map((a) => searchAdapter(a, query, timeoutMs, options)))
}

async function run(
  adapter: Adapter,
  query: string,
  timeoutMs: number,
  persist: boolean,
  parsedQuery: ParsedQuery | undefined,
  allowRequery: boolean,
): Promise<AdapterSearchResult> {
  const started = performance.now()
  const parsed = parsedQuery ?? (await parseQuery(query))
  try {
    if (!sourceCanAttempt(adapter.id)) {
      throw new Error('source circuit open after repeated failures')
    }
    const searchQuery = parsed.refinedQuery || query
    // Hard ceiling on top of the AbortSignal: some adapters don't honor abort
    // and would otherwise hang every section awaiting this promise.
    let raw = dedupeListings(
      await withHardTimeout(
        adapter.search(searchQuery, AbortSignal.timeout(timeoutMs)),
        timeoutMs + 1500,
        `${adapter.label} search`,
      ),
    )
    let ranked = await rankByRelevance(query, raw, parsed, recallModeForType(adapter.type))
    // Demanded materials are mandatory (deterministic twin of the judge's
    // rule) — applied here so every view, persist, and the clusters section
    // see the same gated set.
    ranked.kept = materialGate(query, parsed, ranked.kept)

    // Low-recall expansion keeps the literal lane and adds one controlled
    // category/model variant. An LLM store-specific rewrite is only a final
    // fallback when the literal search found nothing and no deterministic
    // variant exists. Everything is reranked against the original query.
    if (
      (ranked.kept.length < 3 || (ranked.kept[0]?.score ?? 0) < 0.32) &&
      allowRequery &&
      adapter.type !== 'mock' &&
      adapter.type !== 'shopify'
    ) {
      const variants = buildQueryVariants(buildSearchSpec(query))
      const deterministicAlt = variants.find(
        (variant) => variant !== searchQuery.toLowerCase() && variant !== query.toLowerCase(),
      )
      const alt = deterministicAlt ?? (
        ranked.kept.length === 0
          ? await reformulateForStore(query, adapter.label, adapter.type)
          : null
      )
      if (alt && alt !== searchQuery.toLowerCase()) {
        try {
          const altRaw = dedupeListings(
            await withHardTimeout(
              adapter.search(alt, AbortSignal.timeout(timeoutMs)),
              timeoutMs + 1500,
              `${adapter.label} re-query`,
            ),
          )
          const mergedRaw = dedupeListings([...raw, ...altRaw])
          const altRanked = await rankByRelevance(
            query,
            mergedRaw,
            parsed,
            recallModeForType(adapter.type),
          )
          altRanked.kept = materialGate(query, parsed, altRanked.kept)
          if (
            altRanked.kept.length > ranked.kept.length ||
            (altRanked.kept[0]?.score ?? 0) > (ranked.kept[0]?.score ?? 0)
          ) {
            console.log(
              `[expansion] ${adapter.label}: "${alt}" produced ${altRanked.kept.length} candidates`,
            )
            ranked = altRanked
            raw = mergedRaw
          }
        } catch (err) {
          console.warn(
            `[requery] ${adapter.label} retry failed:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
    }
    // Persistence, enrichment, and entity maintenance are valuable but not
    // part of retrieval. Keep them off the response path: the live candidates
    // are already in memory and the next request can use the refreshed catalog.
    if (persist) {
      const persistInBackground = async () => {
        try {
          await persistListings(
            adapter.id,
            ranked.kept.map((r) => r.listing),
            ranked.kept.map((r) => r.embedding),
          )
        } catch (err) {
          console.error(`[persist] ${adapter.label}:`, err)
        }
      }
      scheduleAfter(persistInBackground)
    }
    const elapsedMs = Math.round(performance.now() - started)
    recordSourceSuccess(adapter.id, elapsedMs)
    return {
      adapter,
      kept: ranked.kept,
      rawCount: raw.length,
      elapsedMs,
      failed: false,
      fromCache: false,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    const elapsedMs = Math.round(performance.now() - started)
    if (!message.includes('circuit open')) {
      recordSourceFailure(adapter.id, elapsedMs)
    }
    scheduleAfter(() => recordAdapterError(adapter.id, message).catch(() => {}))
    // warn, not error: adapter failures are routine (bot-blocks, timeouts) and
    // already recorded to the retailer row for /sources. console.error here
    // makes the Next dev overlay flash errors on every search.
    console.warn(`[adapter] ${adapter.label}: ${message}`)

    // Fallback: rank this retailer's recently-seen listings through the same
    // pipeline, so a flaky fetch doesn't flip the store in and out of the
    // results between visits.
    try {
      // Retailer history is not keyed by query. Apply a strict lexical gate
      // before semantic ranking so a failed "running shoes" fetch cannot
      // reuse wireless-earbud rows merely because both mention "running".
      const cached = cachedListingsForQuery(
        parsed.refinedQuery || query,
        dedupeListings(await loadRecentListings(adapter.id)),
      )
      if (cached.length > 0) {
        const ranked = await rankByRelevance(
          query,
          cached,
          parsed,
          'strict',
        )
        ranked.kept = materialGate(query, parsed, ranked.kept)
        if (ranked.kept.length > 0) {
          return {
            adapter,
            kept: ranked.kept,
            rawCount: cached.length,
            elapsedMs,
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
      elapsedMs,
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
