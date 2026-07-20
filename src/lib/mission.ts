import { getAdapters, ADAPTER_TIMEOUT_MS } from '@/lib/adapters/registry'
import { searchAllAdapters } from '@/lib/fanout'
import { generateJson } from '@/lib/llm/client'
import { planMission, type MissionPlan, type MissionQuery } from '@/lib/llm/mission-planner'
import { formatPrice } from '@/lib/format'
import { CATALOG_DUMP_TYPES } from '@/lib/relevance'
import { hasTokenCoverage } from '@/lib/text'

const NON_SHOP_TYPES = new Set(['reddit', 'rss', 'mock'])

export type MissionCandidate = {
  id: string
  title: string
  priceMinor: number
  currency: string
  store: string
  storeType: string
  url: string
  imageUrl?: string
  query: string
  score: number
}

export type MissionPick = {
  title: string
  priceMinor: number
  currency: string
  store: string
  url: string
  imageUrl?: string
  query: string
  why: string
  rank: number
}

export type MissionResult = {
  mission: string
  plan: MissionPlan
  picks: MissionPick[]
  candidatesConsidered: number
  storesSearched: number
  scourSearchUrls: { q: string; url: string }[]
}

function buildSearchQ(mq: MissionQuery): string {
  // Bake price into the string so parseQuery / material gates still apply.
  let q = mq.q
  if (mq.maxPriceMinor != null && mq.maxPriceMinor > 0) {
    q += ` under $${(mq.maxPriceMinor / 100).toFixed(mq.maxPriceMinor % 100 === 0 ? 0 : 2)}`
  }
  if (mq.minPriceMinor != null && mq.minPriceMinor > 0) {
    q += ` above $${(mq.minPriceMinor / 100).toFixed(mq.minPriceMinor % 100 === 0 ? 0 : 2)}`
  }
  return q
}

async function searchOneQuery(
  mq: MissionQuery,
  adapters: Awaited<ReturnType<typeof getAdapters>>,
): Promise<MissionCandidate[]> {
  const q = buildSearchQ(mq)
  const results = await searchAllAdapters(adapters, q, ADAPTER_TIMEOUT_MS)
  const out: MissionCandidate[] = []
  for (const r of results) {
    if (r.failed) continue
    for (const item of r.kept.slice(0, 4)) {
      const l = item.listing
      if (!l.priceMinor || l.priceMinor <= 0) continue
      if (
        CATALOG_DUMP_TYPES.has(r.adapter.type) &&
        (item.score < 0.35 || !hasTokenCoverage(mq.q, [l.title, l.detailsText]))
      ) {
        continue
      }
      if (
        (mq.maxPriceMinor != null || mq.minPriceMinor != null) &&
        l.currency !== 'USD'
      ) {
        continue
      }
      if (mq.maxPriceMinor != null && l.priceMinor > mq.maxPriceMinor) continue
      if (mq.minPriceMinor != null && l.priceMinor < mq.minPriceMinor) continue
      out.push({
        id: `${r.adapter.id}:${l.externalId}`,
        title: l.title,
        priceMinor: l.priceMinor,
        currency: l.currency || 'USD',
        store: r.adapter.label,
        storeType: r.adapter.type,
        url: l.url,
        imageUrl: l.imageUrl,
        query: mq.q,
        score: item.score,
      })
    }
  }
  // Best relevance then cheapest per query
  out.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.04) return b.score - a.score
    return a.priceMinor - b.priceMinor
  })
  return out.slice(0, 8)
}

const RANK_SYSTEM = `You rank shopping shortlist candidates for a Scour mission.
Return ONLY JSON: { "picks": [ { "id": string, "rank": number } ] }

Rules:
- Pick at most 5 ids from the candidates list. rank is 1 = best.
- Prefer items that match criteria, fit budget, and offer clear value.
- Diversify: don't pick 5 near-duplicates of the same product unless nothing else fits.
- Only use ids from the provided list. Never invent products.`

async function rankPicks(
  plan: MissionPlan,
  candidates: MissionCandidate[],
): Promise<MissionPick[]> {
  if (candidates.length === 0) return []

  // Cheap deterministic fallback when LLM is down
  const fallback = (): MissionPick[] =>
    candidates.slice(0, 5).map((c, i) => ({
      title: c.title,
      priceMinor: c.priceMinor,
      currency: c.currency,
      store: c.store,
      url: c.url,
      imageUrl: c.imageUrl,
      query: c.query,
      why: `Strong match for “${c.query}” at ${formatPrice(c.priceMinor, c.currency)}.`,
      rank: i + 1,
    }))

  const catalog = candidates.slice(0, 24).map((c) => ({
    id: c.id,
    title: c.title.slice(0, 100),
    price: formatPrice(c.priceMinor, c.currency),
    store: c.store,
    forQuery: c.query,
  }))

  try {
    const raw = await generateJson(
      {
        system: RANK_SYSTEM,
        user: JSON.stringify({
          mission: plan.summary,
          criteria: plan.criteria,
          budgetMax: plan.budgetMaxMinor
            ? formatPrice(plan.budgetMaxMinor, 'USD')
            : null,
          candidates: catalog,
        }),
        tier: 'fast',
        maxTokens: 800,
      },
      AbortSignal.timeout(12_000),
    )
    const parsed = JSON.parse(raw) as { picks?: unknown }
    if (!Array.isArray(parsed.picks)) return fallback()

    const byId = new Map(candidates.map((c) => [c.id, c]))
    const picks: MissionPick[] = []
    const used = new Set<string>()
    for (const p of parsed.picks) {
      if (!p || typeof p !== 'object') continue
      const row = p as Record<string, unknown>
      if (typeof row.id !== 'string') continue
      const c = byId.get(row.id)
      if (!c || used.has(c.id)) continue
      used.add(c.id)
      picks.push({
        title: c.title,
        priceMinor: c.priceMinor,
        currency: c.currency,
        store: c.store,
        url: c.url,
        imageUrl: c.imageUrl,
        query: c.query,
        why: `Strong match for “${c.query}” at ${formatPrice(c.priceMinor, c.currency)}.`,
        rank: typeof row.rank === 'number' ? row.rank : picks.length + 1,
      })
      if (picks.length >= 5) break
    }
    picks.sort((a, b) => a.rank - b.rank)
    return picks.length > 0 ? picks : fallback()
  } catch (err) {
    console.warn('[mission] rank failed:', err)
    return fallback()
  }
}

/**
 * Full shopping mission: plan → multi-query fan-out → LLM shortlist.
 */
export async function runMission(
  mission: string,
  opts?: { baseUrl?: string },
): Promise<MissionResult> {
  const plan = await planMission(mission)
  const base = (opts?.baseUrl ?? '').replace(/\/$/, '')

  if (plan.queries.length === 0) {
    return {
      mission,
      plan,
      picks: [],
      candidatesConsidered: 0,
      storesSearched: 0,
      scourSearchUrls: [],
    }
  }

  const adapters = (await getAdapters()).filter((a) => !NON_SHOP_TYPES.has(a.type))
  const perQuery = await Promise.all(plan.queries.map((mq) => searchOneQuery(mq, adapters)))
  const candidates = perQuery.flat()

  // Deduplicate near-identical titles across queries
  const seen = new Set<string>()
  const unique: MissionCandidate[] = []
  for (const c of candidates) {
    const key = c.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 50)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }

  const picks = await rankPicks(plan, unique)

  return {
    mission,
    plan,
    picks,
    candidatesConsidered: unique.length,
    storesSearched: adapters.length,
    scourSearchUrls: plan.queries.map((mq) => {
      const q = buildSearchQ(mq)
      return { q, url: `${base}/search?q=${encodeURIComponent(q)}` }
    }),
  }
}
