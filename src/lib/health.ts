import { prisma } from '@/lib/db'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'
import { loadSearchHtml } from '@/lib/adapters/generic-html'
import { extractListings } from '@/lib/adapters/generic-extract'
import { diagnoseZeroResults } from '@/lib/adapters/diagnose'
import { repairGenericAdapter } from '@/lib/llm/adapter-repair'
import { recordAdapterError } from '@/lib/persist'

// Canary health check for agent-onboarded (generic-html) sources. Rather than
// wait for a user to stumble onto a broken store, this probes each source with
// a few known queries and acts on the result: repair stale selectors, flag a
// bot-block, or note a genuinely empty source — so /sources surfaces problems
// proactively. Meant to run on a schedule (see prisma/canary.ts).

export type CanaryStatus =
  | 'ok'
  | 'stale' // needs repair; not attempted (dry run)
  | 'repaired'
  | 'repair-failed'
  | 'blocked'
  | 'empty'
  | 'config-error'

export type CanaryReport = {
  retailerId: string
  domain: string
  label: string
  status: CanaryStatus
  query: string
  count: number
  detail?: string
}

type RetailerRow = {
  id: string
  identifier: string
  label: string | null
  config: string | null
}

// Single-brand storefronts usually return their full catalog for their own
// name; the generic terms catch multi-brand stores that don't sell the first.
const FALLBACK_QUERIES = ['sale', 'shirt', 'gift', 'bag', 'shoe']

function canaryQueries(config: GenericHtmlConfig): string[] {
  const queries: string[] = []
  const brand = config.brandName?.trim().split(/\s+/)[0]?.toLowerCase()
  if (brand && brand.length >= 3) queries.push(brand)
  for (const q of FALLBACK_QUERIES) if (!queries.includes(q)) queries.push(q)
  return queries
}

async function markHealthy(retailerId: string): Promise<void> {
  await prisma.retailer.update({
    where: { id: retailerId },
    data: { lastFetchedAt: new Date(), lastError: null },
  })
}

/**
 * Probe one agent-onboarded source. Healthy if any canary query extracts at
 * least one listing. If all come back empty, diagnose why and act: repair stale
 * selectors, flag a block, or note a genuine empty. Mutates retailer health
 * fields unless `dryRun`.
 */
export async function checkSource(
  retailer: RetailerRow,
  opts: { dryRun?: boolean } = {},
): Promise<CanaryReport> {
  const domain = retailer.identifier
  const label = retailer.label ?? domain
  const base = { retailerId: retailer.id, domain, label }

  if (!retailer.config) {
    return { ...base, status: 'config-error', query: '', count: 0, detail: 'no config stored' }
  }
  let config: GenericHtmlConfig
  try {
    config = JSON.parse(retailer.config) as GenericHtmlConfig
  } catch {
    return { ...base, status: 'config-error', query: '', count: 0, detail: 'config JSON corrupt' }
  }

  const queries = canaryQueries(config)
  let lastHtml = ''
  let lastQuery = queries[0] ?? 'sale'

  for (const q of queries) {
    lastQuery = q
    try {
      lastHtml = await loadSearchHtml(config, q, domain, label)
    } catch {
      lastHtml = ''
      continue // network/render error — try the next query before giving up
    }
    const count = extractListings(lastHtml, config, domain, label).length
    if (count > 0) {
      if (!opts.dryRun) await markHealthy(retailer.id)
      return { ...base, status: 'ok', query: q, count }
    }
  }

  // Zero across every canary query — figure out why from the last page we saw.
  const cause = lastHtml ? diagnoseZeroResults(lastHtml, config) : 'empty'

  if (cause === 'stale') {
    if (opts.dryRun) {
      return { ...base, status: 'stale', query: lastQuery, count: 0, detail: 'stale selectors — would auto-repair' }
    }
    const fixed = await repairGenericAdapter(domain, config, lastQuery)
    if (fixed) {
      if (!opts.dryRun) {
        await prisma.retailer.update({
          where: { id: retailer.id },
          data: { config: JSON.stringify(fixed), lastFetchedAt: new Date(), lastError: null },
        })
      }
      return { ...base, status: 'repaired', query: lastQuery, count: 0, detail: 'stale selectors auto-fixed' }
    }
    if (!opts.dryRun) await recordAdapterError(retailer.id, 'stale selectors; auto-repair failed')
    return { ...base, status: 'repair-failed', query: lastQuery, count: 0 }
  }

  if (cause === 'blocked') {
    if (!opts.dryRun) {
      await recordAdapterError(retailer.id, 'source served a bot challenge; skipped auto-repair')
    }
    return { ...base, status: 'blocked', query: lastQuery, count: 0 }
  }

  if (!opts.dryRun) await recordAdapterError(retailer.id, 'no products for canary queries')
  return { ...base, status: 'empty', query: lastQuery, count: 0 }
}

/** Probe every enabled agent-onboarded source, sequentially. */
export async function runCanary(opts: { dryRun?: boolean } = {}): Promise<CanaryReport[]> {
  const retailers = await prisma.retailer.findMany({
    where: { enabled: true, type: 'generic-html' },
    select: { id: true, identifier: true, label: true, config: true },
    orderBy: { identifier: 'asc' },
  })

  const reports: CanaryReport[] = []
  for (const r of retailers) {
    reports.push(await checkSource(r, opts))
  }
  return reports
}
