import { generateJson } from './client'

export type MissionQuery = {
  q: string
  maxPriceMinor?: number
  minPriceMinor?: number
  reason: string
}

export type MissionPlan = {
  summary: string
  recipient?: string
  occasion?: string
  budgetMaxMinor?: number
  budgetMinMinor?: number
  criteria: string[]
  queries: MissionQuery[]
}

const SYSTEM = `You are Scour's shopping-mission planner. The user describes a goal (gift, setup, restock, upgrade). You turn it into concrete product searches Scour can run across many stores.

Return ONLY a JSON object:
{
  "summary": string,           // one short sentence of the mission
  "recipient": string?,        // who it's for, if known
  "occasion": string?,         // birthday, apartment, etc.
  "budgetMaxMinor": number?,   // total budget ceiling in cents if stated
  "budgetMinMinor": number?,   // floor in cents if stated
  "criteria": string[],        // 2-5 short decision criteria (practical, durable, …)
  "queries": [                 // 2-5 product searches to run in parallel
    {
      "q": string,             // clean product search, no gift prose
      "maxPriceMinor": number?,// per-item price ceiling in cents
      "minPriceMinor": number?,
      "reason": string         // why this query helps the mission
    }
  ]
}

Rules:
- queries[].q must be a shoppable product phrase ("pour over coffee maker", not "something dad would like").
- Prefer 3 queries; never more than 5; never fewer than 2 if the mission is coherent.
- If a total budget is given, set per-query maxPriceMinor so one item could fit (don't spend the whole budget on one query unless the mission is a single product).
- Split multi-item missions ("starter kitchen kit") into distinct product types.
- Do not invent brands unless the user named them.
- criteria are for ranking picks later — short and actionable.
- If the message is not a shopping mission, still invent the closest reasonable product searches from it.

Examples:
  "gift for dad under $50 who likes coffee"
  → summary "Coffee gift under $50 for dad", budgetMaxMinor 5000,
    queries: pour over kit / coffee grinder / quality mug set (each max ~5000)

  "mechanical keyboard under $120, quiet for office"
  → one primary query plus a backup (e.g. silent switches, low-profile)
`

function validate(raw: unknown, mission: string): MissionPlan {
  const fallback: MissionPlan = {
    summary: mission.slice(0, 120),
    criteria: ['good value', 'relevant to the request'],
    queries: [{ q: mission.slice(0, 80), reason: 'direct search from the mission text' }],
  }
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as Record<string, unknown>

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim().slice(0, 160)
      : fallback.summary

  const criteria = Array.isArray(obj.criteria)
    ? obj.criteria
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim().slice(0, 60))
        .slice(0, 5)
    : fallback.criteria

  const queries: MissionQuery[] = []
  if (Array.isArray(obj.queries)) {
    for (const item of obj.queries) {
      if (!item || typeof item !== 'object') continue
      const q = item as Record<string, unknown>
      if (typeof q.q !== 'string' || !q.q.trim()) continue
      const entry: MissionQuery = {
        q: q.q.trim().slice(0, 100),
        reason:
          typeof q.reason === 'string' && q.reason.trim()
            ? q.reason.trim().slice(0, 120)
            : 'related product',
      }
      if (typeof q.maxPriceMinor === 'number' && Number.isFinite(q.maxPriceMinor)) {
        entry.maxPriceMinor = Math.round(q.maxPriceMinor)
      }
      if (typeof q.minPriceMinor === 'number' && Number.isFinite(q.minPriceMinor)) {
        entry.minPriceMinor = Math.round(q.minPriceMinor)
      }
      queries.push(entry)
      if (queries.length >= 5) break
    }
  }
  if (queries.length === 0) return fallback

  const plan: MissionPlan = { summary, criteria, queries }
  if (typeof obj.recipient === 'string' && obj.recipient.trim()) {
    plan.recipient = obj.recipient.trim().slice(0, 60)
  }
  if (typeof obj.occasion === 'string' && obj.occasion.trim()) {
    plan.occasion = obj.occasion.trim().slice(0, 60)
  }
  if (typeof obj.budgetMaxMinor === 'number' && Number.isFinite(obj.budgetMaxMinor)) {
    plan.budgetMaxMinor = Math.round(obj.budgetMaxMinor)
  }
  if (typeof obj.budgetMinMinor === 'number' && Number.isFinite(obj.budgetMinMinor)) {
    plan.budgetMinMinor = Math.round(obj.budgetMinMinor)
  }
  return plan
}

/**
 * Turn a free-text shopping mission into structured parallel searches.
 * Degrades to a single direct query when the LLM is unavailable.
 */
export async function planMission(mission: string): Promise<MissionPlan> {
  const trimmed = mission.trim().slice(0, 500)
  if (!trimmed) {
    return {
      summary: '',
      criteria: [],
      queries: [],
    }
  }

  try {
    const raw = await generateJson(
      {
        system: SYSTEM,
        user: trimmed,
        tier: 'fast',
        maxTokens: 700,
      },
      AbortSignal.timeout(12_000),
    )
    return validate(JSON.parse(raw), trimmed)
  } catch (err) {
    console.warn('[mission-planner] LLM failed, using fallback:', err)
    return validate(null, trimmed)
  }
}
