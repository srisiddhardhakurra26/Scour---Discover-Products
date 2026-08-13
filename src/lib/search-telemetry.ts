import { prisma } from '@/lib/db'
import { createHash, createHmac } from 'node:crypto'

export const SEARCH_RANKER_VERSION = 'hybrid-rrf-esci-mmr-v1'

export type SearchRunTelemetry = {
  query: string
  intent: string
  spec: unknown
  candidateCount: number
  resultCount: number
  sourceCount: number
  failedSourceCount: number
  latencyMs: number
  diagnostics?: unknown
}

export function hashSearchQuery(query: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ')
  const key = process.env.SEARCH_TELEMETRY_HASH_KEY?.trim()
  return key
    ? createHmac('sha256', key).update(normalized).digest('hex')
    : createHash('sha256').update(normalized).digest('hex')
}

/** Remove query-derived strings before diagnostics are persisted. */
export function privacySafeSearchDiagnostics(
  diagnostics: Record<string, unknown>,
): Record<string, unknown> {
  const { variants, ...safe } = diagnostics
  return {
    ...safe,
    variantCount: Array.isArray(variants) ? variants.length : 0,
  }
}

/** Persist one query-level diagnostic record; never block search on telemetry. */
export async function recordSearchRun(run: SearchRunTelemetry): Promise<string | null> {
  try {
    const row = await prisma.searchRun.create({
      data: {
        queryHash: hashSearchQuery(run.query),
        intent: run.intent.slice(0, 50),
        specJson: JSON.stringify(run.spec).slice(0, 20_000),
        rankerVersion: SEARCH_RANKER_VERSION,
        candidateCount: run.candidateCount,
        resultCount: run.resultCount,
        sourceCount: run.sourceCount,
        failedSourceCount: run.failedSourceCount,
        latencyMs: run.latencyMs,
        diagnosticsJson: run.diagnostics
          ? JSON.stringify(run.diagnostics).slice(0, 20_000)
          : undefined,
      },
      select: { id: true },
    })
    return row.id
  } catch (error) {
    console.warn('[search-telemetry]', error instanceof Error ? error.message : error)
    return null
  }
}
