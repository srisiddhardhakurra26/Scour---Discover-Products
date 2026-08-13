import { generateJson } from './client'
import { explicitProductList } from '@/lib/product-list'

export type SearchIntent = 'product' | 'mission'

type IntentDecision = {
  intent: SearchIntent
  confidence: number
  reason: string
}

const SYSTEM = `Classify a shopping query for Scour. Return ONLY JSON:
{"intent":"product|mission","confidence":0.0,"reason":"short explanation"}

Definitions:
- product: the user wants one product category, including variants, styles, brands, features, or price constraints.
- mission: satisfying the goal requires exploring multiple distinct product categories, assembling a setup/kit/outfit/room, or finding diverse gift ideas.

Critical rules:
- Uncertainty about style does not make a query a mission. "Leather boots over $150, not sure what style" is product.
- Natural-language detail does not make a query a mission. "Quiet keyboard for my office under $120" is product.
- "Furnish a home office under $500" is mission because it needs a desk, chair, lighting, etc.
- "Build a coffee setup under $300" is mission.
- "Gift for a cyclist under $75" is mission because several product categories may fit.
- A terse list of unrelated products is a mission even without commas. "monitor chair backpack" means three required products.
- A normal compound product remains a product. "laptop backpack", "chair mat", and "monitor stand" each name one product category.
- When one product search can directly satisfy the request, choose product.`

const CACHE_TTL_MS = 60 * 60 * 1000
const memo = new Map<string, { decision: IntentDecision; expiresAt: number }>()
const pending = new Map<string, Promise<IntentDecision>>()

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function fallbackSearchIntent(query: string): IntentDecision {
  const normalized = normalize(query)
  const listedProducts = explicitProductList(query)
  if (listedProducts.length >= 2) {
    return {
      intent: 'mission',
      confidence: 0.95,
      reason: `The query lists ${listedProducts.length} separate product categories.`,
    }
  }
  const missionPattern =
    /\b(furnish|equip|stock|assemble|complete setup|starter (?:kit|set|pack)|build (?:me )?(?:a |an )?.*\b(?:setup|kit|office|room|studio|gym|wardrobe)|(?:home|office|gaming|coffee|kitchen|apartment|dorm|workout) setup|gift (?:for|ideas?)|outfit for|essentials for|everything (?:i|we) need)\b/i
  if (missionPattern.test(normalized)) {
    return {
      intent: 'mission',
      confidence: 0.9,
      reason: 'The request spans multiple product categories.',
    }
  }
  return {
    intent: 'product',
    confidence: 0.7,
    reason: 'The request can be satisfied by one product category.',
  }
}

function parseDecision(raw: string, query: string): IntentDecision {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (parsed.intent !== 'product' && parsed.intent !== 'mission') {
    return fallbackSearchIntent(query)
  }
  const confidence =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5
  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 160)
      : parsed.intent === 'mission'
        ? 'The request needs several product categories.'
        : 'The request targets one product category.'
  return { intent: parsed.intent, confidence, reason }
}

async function classifyUncached(query: string): Promise<IntentDecision> {
  try {
    const raw = await generateJson(
      {
        system: SYSTEM,
        user: `Classify this shopping query: ${JSON.stringify(query)}`,
        tier: 'fast',
        maxTokens: 120,
      },
      AbortSignal.timeout(3500),
    )
    return parseDecision(raw, query)
  } catch (err) {
    console.warn('[search-intent]', err instanceof Error ? err.message : err)
    return fallbackSearchIntent(query)
  }
}

export async function classifySearchIntent(query: string): Promise<IntentDecision> {
  const trimmed = query.trim().slice(0, 500)
  if (!trimmed) return fallbackSearchIntent('')
  const key = normalize(trimmed)
  const hit = memo.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.decision

  // Obvious multi-category language is safer and faster to route
  // deterministically, and preserves the LLM budget for actually planning it.
  const fallback = fallbackSearchIntent(trimmed)
  if (fallback.intent === 'mission' && fallback.confidence >= 0.9) {
    memo.set(key, { decision: fallback, expiresAt: Date.now() + CACHE_TTL_MS })
    return fallback
  }
  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  const work = classifyUncached(trimmed)
  pending.set(key, work)
  try {
    const decision = await work
    memo.set(key, { decision, expiresAt: Date.now() + CACHE_TTL_MS })
    return decision
  } finally {
    if (pending.get(key) === work) pending.delete(key)
  }
}
