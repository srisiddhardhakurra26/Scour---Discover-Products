import { generateJson } from './client'
import { parsePriceBounds } from './query-parser'
import { explicitProductList, productListComposition } from '@/lib/product-list'

export type MissionQuery = {
  q: string
  maxPriceMinor?: number
  minPriceMinor?: number
  reason: string
}

export type MissionPlan = {
  summary: string
  composition: 'bundle' | 'alternatives'
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
  "composition": "bundle" | "alternatives",
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
- Use composition "bundle" when the user needs several items together (furnish a room, build a setup, assemble a kit or outfit). Each query is one required slot.
- Use composition "alternatives" when the user will likely choose one item from diverse ideas (for example, a gift brief). Each query is an alternative product category.
- Price direction is literal: "under/below/at most $X" is a maximum; "over/above/at least $X" is a minimum. Never turn a minimum into a maximum or vice versa.
- Prefer 3 queries; never more than 5; never fewer than 2 if the mission is coherent.
- If a total budget is given, set per-query maxPriceMinor so one item could fit (don't spend the whole budget on one query unless the mission is a single product).
- Split multi-item missions ("starter kitchen kit") into distinct product types.
- Do not invent brands unless the user named them.
- criteria are for ranking picks later — short and actionable.
- If the message is not a shopping mission, still invent the closest reasonable product searches from it.

Examples:
  "gift for dad under $50 who likes coffee"
  → composition "alternatives", summary "Coffee gift under $50 for dad", budgetMaxMinor 5000,
    queries: pour over kit / coffee grinder / quality mug set (each max ~5000)

  "furnish a home office under $500"
  → composition "bundle", queries: office desk / ergonomic chair / task lamp.

  "mechanical keyboard under $120, quiet for office"
  → one primary query plus a backup (e.g. silent switches, low-profile)
`

type FallbackQuery = [q: string, reason: string]

/**
 * Keep multi-item search useful when the model is unavailable or rate-limited.
 * These broad category plans are intentionally deterministic: live store
 * results still decide which products make each package.
 */
export function fallbackMissionPlan(mission: string): MissionPlan {
  const text = mission.trim().slice(0, 500)
  const normalized = text.toLowerCase()
  const listedProducts = explicitProductList(text)
  const composition = listedProducts.length >= 2
    ? productListComposition(listedProducts)
    : inferComposition(text)
  let fallbackQueries: FallbackQuery[]

  if (listedProducts.length >= 2) {
    const workspaceList = listedProducts.includes('monitor') && listedProducts.includes('chair')
    fallbackQueries = listedProducts.slice(0, 5).map((product) => [
      workspaceList && product === 'chair'
        ? 'ergonomic office chair'
        : workspaceList && product === 'backpack'
          ? 'laptop backpack'
          : product,
      composition === 'alternatives'
        ? 'explicitly named comparison option'
        : 'explicitly requested as a separate product',
    ])
  } else if (/\b(home office|office setup|workspace)\b/.test(normalized)) {
    fallbackQueries = [
      ['office desk', 'the foundation of the workspace'],
      ['ergonomic office chair', 'comfortable seating for daily work'],
      ['task lamp', 'focused lighting for the desk'],
    ]
  } else if (/\b(coffee (?:setup|station|bar)|coffee lover)\b/.test(normalized)) {
    fallbackQueries = composition === 'bundle'
      ? [
          ['coffee maker', 'the main brewing method'],
          ['coffee grinder', 'freshly grinds beans for brewing'],
          ['electric gooseneck kettle', 'controlled hot-water preparation'],
        ]
      : [
          ['coffee grinder', 'a practical upgrade for a coffee lover'],
          ['pour over coffee maker', 'an approachable manual brewing gift'],
          ['coffee mug set', 'a useful gift at several price points'],
        ]
  } else if (/\b(kitchen|cookware|cooking)\b/.test(normalized)) {
    fallbackQueries = [
      ['cookware set', 'covers the core pots and pans'],
      ['chef knife', 'the primary food-preparation tool'],
      ['cutting board', 'a safe surface for food preparation'],
    ]
  } else if (/\b(gaming|game room|pc setup)\b/.test(normalized)) {
    fallbackQueries = [
      ['gaming monitor', 'the main display for the setup'],
      ['gaming keyboard', 'the primary keyboard input'],
      ['gaming mouse', 'the primary pointing input'],
    ]
  } else if (/\b(living room|lounge)\b/.test(normalized)) {
    fallbackQueries = [
      ['living room seating', 'the main seating for the room'],
      ['coffee table', 'a practical central surface'],
      ['floor lamp', 'ambient lighting for the room'],
    ]
  } else if (/\b(bedroom|sleep setup)\b/.test(normalized)) {
    fallbackQueries = [
      ['bed frame', 'the foundation of the room'],
      ['nightstand', 'bedside storage and surface space'],
      ['bedside lamp', 'task and ambient lighting'],
    ]
  } else if (/\b(outfit|wardrobe)\b/.test(normalized)) {
    fallbackQueries = /\bwedding\b/.test(normalized)
      ? [
          ['linen shirt', 'a summer-appropriate wedding top'],
          ['dress pants', 'a coordinating formal bottom'],
          ['dress shoes', 'wedding-appropriate footwear'],
        ]
      : [
          ['outfit top', 'the upper-body layer'],
          ['outfit pants', 'the coordinating lower-body piece'],
          ['outfit shoes', 'footwear to complete the outfit'],
        ]
  } else if (/\b(cyclist|cycling|bicycle|bike rider)\b/.test(normalized)) {
    fallbackQueries = [
      ['rechargeable bike light', 'a practical visibility upgrade'],
      ['bicycle repair tool kit', 'useful for roadside repairs'],
      ['cycling gloves', 'a comfort-focused riding accessory'],
    ]
  } else {
    const goal = text
      .replace(/\b(?:under|below|less than|at most|over|above|more than|at least)\s*\$\s*\d+(?:\.\d{1,2})?/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70)
    fallbackQueries = composition === 'bundle'
      ? [
          [`${goal} essentials`, 'core items required for the goal'],
          [`${goal} accessories`, 'supporting items for the goal'],
          [`${goal} storage`, 'organization for the completed setup'],
        ]
      : [
          [goal, 'the closest direct product search'],
          [`practical ${goal}`, 'a utility-focused alternative'],
          [`premium ${goal}`, 'a quality-focused alternative'],
        ]
  }

  return {
    summary: text.slice(0, 120),
    composition,
    criteria: ['good value', 'relevant to the request', 'category coverage'],
    queries: fallbackQueries.map(([q, reason]) => ({ q, reason })),
  }
}

function validate(raw: unknown, mission: string): MissionPlan {
  const fallback = fallbackMissionPlan(mission)
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
  const composition =
    obj.composition === 'bundle' || obj.composition === 'alternatives'
      ? obj.composition
      : inferComposition(mission)
  if (queries.length < 2) return fallback
  const plan: MissionPlan = { summary, composition, criteria, queries }
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

function inferComposition(mission: string): MissionPlan['composition'] {
  return /\b(furnish|equip|stock|assemble|setup|starter|kit|outfit|essentials|everything (?:i|we) need)\b/i.test(
    mission,
  )
    ? 'bundle'
    : 'alternatives'
}

/**
 * Numeric price direction is too important to trust to model output. Apply
 * the same deterministic parser used by normal search, overriding any
 * contradictory budget or per-query constraint emitted by the planner.
 */
export function enforceMissionPriceBounds(
  plan: MissionPlan,
  mission: string,
): MissionPlan {
  const bounds = parsePriceBounds(mission)
  if (bounds.minPriceMinor == null && bounds.maxPriceMinor == null) return plan

  const corrected: MissionPlan = {
    ...plan,
    queries: plan.queries.map((query) => {
      const next = { ...query }
      if (plan.composition === 'alternatives') {
        if (bounds.minPriceMinor != null) next.minPriceMinor = bounds.minPriceMinor
        else delete next.minPriceMinor
        if (bounds.maxPriceMinor != null) next.maxPriceMinor = bounds.maxPriceMinor
        else delete next.maxPriceMinor
      } else {
        // Bundle bounds constrain the combined package. A $500 minimum does
        // not mean every chair, desk, and lamp must individually cost $500.
        delete next.minPriceMinor
        if (bounds.maxPriceMinor != null) {
          next.maxPriceMinor = Math.min(
            next.maxPriceMinor ?? bounds.maxPriceMinor,
            bounds.maxPriceMinor,
          )
        } else {
          delete next.maxPriceMinor
        }
      }
      return next
    }),
  }

  if (bounds.minPriceMinor != null) corrected.budgetMinMinor = bounds.minPriceMinor
  else delete corrected.budgetMinMinor
  if (bounds.maxPriceMinor != null) corrected.budgetMaxMinor = bounds.maxPriceMinor
  else delete corrected.budgetMaxMinor
  return corrected
}

/**
 * Turn a free-text shopping mission into structured parallel searches.
 * Degrades to a deterministic multi-category plan when the LLM is unavailable.
 */
export async function planMission(mission: string): Promise<MissionPlan> {
  const trimmed = mission.trim().slice(0, 500)
  if (!trimmed) {
    return {
      summary: '',
      composition: 'alternatives',
      criteria: [],
      queries: [],
    }
  }

  // An explicit product list needs no model interpretation. Preserving each
  // noun as its own required slot also prevents a planner from merging the
  // phrase back into one broad search.
  if (explicitProductList(trimmed).length >= 2) {
    return enforceMissionPriceBounds(fallbackMissionPlan(trimmed), trimmed)
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
    return enforceMissionPriceBounds(validate(JSON.parse(raw), trimmed), trimmed)
  } catch (err) {
    console.warn('[mission-planner] LLM failed, using fallback:', err)
    return enforceMissionPriceBounds(validate(null, trimmed), trimmed)
  }
}
