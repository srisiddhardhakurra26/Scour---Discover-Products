import { getAdapters, ADAPTER_TIMEOUT_MS } from '@/lib/adapters/registry'
import { searchAllAdapters } from '@/lib/fanout'
import { planMission, type MissionPlan, type MissionQuery } from '@/lib/llm/mission-planner'
import { formatPrice } from '@/lib/format'
import { CATALOG_DUMP_TYPES } from '@/lib/relevance'
import { hasTokenCoverage } from '@/lib/text'

const NON_SHOP_TYPES = new Set(['reddit', 'rss', 'mock'])

export function matchesConsoleHardware(query: string, title: string): boolean {
  const q = query.toLowerCase()
  if (!q.includes('console')) return true
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (/playstation 5/.test(q)) {
    return (
      /\b(?:playstation\s*5|ps5)\b/.test(normalized) &&
      (/^(?:sony\s+)?playstation\s*5\b/.test(normalized) ||
        /\b(?:console|digital edition|disc edition|slim|pro|\d+\s*(?:gb|tb)|bundle)\b/.test(normalized))
    )
  }
  if (/xbox/.test(q)) {
    return (
      /\bxbox\b/.test(normalized) &&
      (/^(?:microsoft\s+)?xbox\s+(?:series\s+[xs]|one\s+[xs]?)\b/.test(normalized) ||
        /\bconsole\b/.test(normalized)) &&
      !/\b(?:game|standard edition|campaign|controller|headset|skin|case|cover|stand|charging|gift card)\b/.test(normalized)
    )
  }
  return true
}

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

export type MissionSlotResult = {
  query: MissionQuery
  picks: MissionPick[]
}

export type MissionBundle = {
  id: string
  label: string
  description: string
  items: MissionPick[]
  totalMinor: number
  currency: string
}

export type MissionResult = {
  mission: string
  plan: MissionPlan
  picks: MissionPick[]
  bundles: MissionBundle[]
  slots: MissionSlotResult[]
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
  // Mission candidates are consumed directly from adapter results. Persisting
  // and clustering every candidate would add dozens of sequential LLM judge
  // calls before the user sees the shortlist, and can turn a brief request
  // into a multi-minute one under provider rate limits.
  const results = await searchAllAdapters(adapters, q, ADAPTER_TIMEOUT_MS, {
    persist: false,
    allowRequery: false,
    parsedQuery: {
      refinedQuery: mq.q,
      maxPriceMinor: mq.maxPriceMinor,
      minPriceMinor: mq.minPriceMinor,
    },
  })
  const out: MissionCandidate[] = []
  for (const r of results) {
    if (r.failed) continue
    let acceptedForStore = 0
    for (const item of r.kept) {
      const l = item.listing
      if (!l.priceMinor || l.priceMinor <= 0) continue
      if (!matchesConsoleHardware(mq.q, l.title)) continue
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
      acceptedForStore++
      if (acceptedForStore >= 4) break
    }
  }
  // Best relevance then cheapest per query
  out.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.04) return b.score - a.score
    return a.priceMinor - b.priceMinor
  })
  return out.slice(0, 8)
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80)
}

function toPick(candidate: MissionCandidate, rank: number): MissionPick {
  return {
    title: candidate.title,
    priceMinor: candidate.priceMinor,
    currency: candidate.currency,
    store: candidate.store,
    url: candidate.url,
    imageUrl: candidate.imageUrl,
    query: candidate.query,
    why: `Strong match for “${candidate.query}” at ${formatPrice(candidate.priceMinor, candidate.currency)}.`,
    rank,
  }
}

function diversePicks(perQuery: MissionCandidate[][], limit = 5): MissionPick[] {
  const selected: MissionCandidate[] = []
  const seen = new Set<string>()
  const depth = Math.max(0, ...perQuery.map((candidates) => candidates.length))
  for (let index = 0; index < depth && selected.length < limit; index++) {
    for (const candidates of perQuery) {
      const candidate = candidates[index]
      if (!candidate) continue
      const key = titleKey(candidate.title)
      if (seen.has(key)) continue
      seen.add(key)
      selected.push(candidate)
      if (selected.length >= limit) break
    }
  }
  return selected.map((candidate, index) => toPick(candidate, index + 1))
}

type BundleCombination = {
  items: MissionCandidate[]
  totalMinor: number
  relevance: number
  currency: string
}

function enumerateBundles(
  perQuery: MissionCandidate[][],
  plan: MissionPlan,
): BundleCombination[] {
  if (perQuery.length < 2 || perQuery.some((candidates) => candidates.length === 0)) return []
  const combinations: BundleCombination[] = []

  function visit(slot: number, items: MissionCandidate[], ids: Set<string>, titles: Set<string>) {
    if (slot === perQuery.length) {
      const currencies = new Set(items.map((item) => item.currency))
      if (currencies.size !== 1) return
      const totalMinor = items.reduce((sum, item) => sum + item.priceMinor, 0)
      if (plan.budgetMaxMinor != null && totalMinor > plan.budgetMaxMinor) return
      if (plan.budgetMinMinor != null && totalMinor < plan.budgetMinMinor) return
      combinations.push({
        items: [...items],
        totalMinor,
        relevance: items.reduce((sum, item) => sum + item.score, 0) / items.length,
        currency: items[0].currency,
      })
      return
    }

    for (const candidate of perQuery[slot].slice(0, 8)) {
      const title = titleKey(candidate.title)
      if (ids.has(candidate.id) || titles.has(title)) continue
      const partialTotal = items.reduce((sum, item) => sum + item.priceMinor, 0)
      if (
        plan.budgetMaxMinor != null &&
        partialTotal + candidate.priceMinor > plan.budgetMaxMinor
      ) {
        continue
      }
      ids.add(candidate.id)
      titles.add(title)
      items.push(candidate)
      visit(slot + 1, items, ids, titles)
      items.pop()
      ids.delete(candidate.id)
      titles.delete(title)
    }
  }

  visit(0, [], new Set(), new Set())
  return combinations
}

/** Build complete, budget-valid packages with exactly one item per plan slot. */
export function buildMissionBundles(
  plan: MissionPlan,
  perQuery: MissionCandidate[][],
): MissionBundle[] {
  const combinations = enumerateBundles(perQuery, plan)
  if (combinations.length === 0) return []

  const utilization = (combination: BundleCombination) =>
    plan.budgetMaxMinor
      ? Math.min(1, combination.totalMinor / plan.budgetMaxMinor)
      : 0
  const balanced = [...combinations].sort(
    (a, b) =>
      b.relevance * 0.75 + utilization(b) * 0.25 -
        (a.relevance * 0.75 + utilization(a) * 0.25),
  )[0]
  const value = [...combinations].sort(
    (a, b) => a.totalMinor - b.totalMinor || b.relevance - a.relevance,
  )[0]
  const premium = [...combinations].sort(
    (a, b) => b.totalMinor - a.totalMinor || b.relevance - a.relevance,
  )[0]

  const choices = [
    {
      value: balanced,
      label: 'Balanced setup',
      description: 'Best blend of match quality and budget use.',
    },
    {
      value,
      label: 'Best value',
      description: 'A complete setup with the lowest combined price.',
    },
    {
      value: premium,
      label: plan.budgetMaxMinor ? 'Maximize the budget' : 'Premium setup',
      description: plan.budgetMaxMinor
        ? 'Stronger-priced picks while staying within the total budget.'
        : 'Higher-priced picks across every required category.',
    },
  ]

  const seen = new Set<string>()
  const bundles: MissionBundle[] = []
  for (const choice of choices) {
    const signature = choice.value.items.map((item) => item.id).join('|')
    if (seen.has(signature)) continue
    seen.add(signature)
    bundles.push({
      id: `bundle-${bundles.length + 1}`,
      label: choice.label,
      description: choice.description,
      items: choice.value.items.map((candidate, index) => toPick(candidate, index + 1)),
      totalMinor: choice.value.totalMinor,
      currency: choice.value.currency,
    })
  }
  return bundles
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
      bundles: [],
      slots: [],
      candidatesConsidered: 0,
      storesSearched: 0,
      scourSearchUrls: [],
    }
  }

  const adapters = (await getAdapters()).filter((a) => !NON_SHOP_TYPES.has(a.type))
  const rawPerQuery = await Promise.all(plan.queries.map((mq) => searchOneQuery(mq, adapters)))
  const globallySeen = new Set<string>()
  const perQuery = rawPerQuery.map((candidates) =>
    candidates.filter((candidate) => {
      const key = titleKey(candidate.title)
      if (globallySeen.has(key)) return false
      globallySeen.add(key)
      return true
    }),
  )
  const candidates = perQuery.flat()
  const bundles = plan.composition === 'bundle' ? buildMissionBundles(plan, perQuery) : []
  const picks =
    plan.composition === 'bundle' && bundles.length > 0
      ? bundles[0].items
      : diversePicks(perQuery)
  const slots = plan.queries.map((query, index) => ({
    query,
    picks: perQuery[index]
      .slice(0, 3)
      .map((candidate, pickIndex) => toPick(candidate, pickIndex + 1)),
  }))

  return {
    mission,
    plan,
    picks,
    bundles,
    slots,
    candidatesConsidered: candidates.length,
    storesSearched: adapters.length,
    scourSearchUrls: plan.queries.map((mq) => {
      const q = buildSearchQ(mq)
      return { q, url: `${base}/search?q=${encodeURIComponent(q)}&mode=product` }
    }),
  }
}
