import type { RerankCandidate, RerankScores } from './llm/rerank'

// General query-document cross-encoder converted to quantized ONNX for
// Transformers.js. Deterministic SearchSpec gates still decide ESCI roles;
// this model sharpens the ordering inside the eligible set without a hosted
// LLM or rate limit.
const MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2'
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 8_000

type PairTokenizer = (
  text: string[],
  options: {
    text_pair: string[]
    padding: boolean
    truncation: boolean
    max_length: number
  },
) => Record<string, unknown>

type SequenceClassifier = (
  inputs: Record<string, unknown>,
) => Promise<{ logits: { data: ArrayLike<number> } }>

type LocalModel = {
  tokenizer: PairTokenizer
  model: SequenceClassifier
}

type CacheEntry = { score: number; expiresAt: number }

const globalForReranker = globalThis as unknown as {
  __scourLocalReranker?: Promise<LocalModel>
  __scourLocalRerankerUnavailable?: boolean
  __scourLocalRerankerCache?: Map<string, CacheEntry>
}

function localRerankerCache(): Map<string, CacheEntry> {
  if (!globalForReranker.__scourLocalRerankerCache) {
    globalForReranker.__scourLocalRerankerCache = new Map()
  }
  return globalForReranker.__scourLocalRerankerCache
}

function cacheKey(query: string, candidate: RerankCandidate): string {
  return `${query.trim().toLowerCase()}::${candidate.id}`
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value))
  const exp = Math.exp(value)
  return exp / (1 + exp)
}

async function loadModel(): Promise<LocalModel> {
  const { AutoModelForSequenceClassification, AutoTokenizer } = await import(
    '@huggingface/transformers'
  )
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { dtype: 'q8' }),
  ])
  return {
    tokenizer: tokenizer as unknown as PairTokenizer,
    model: model as unknown as SequenceClassifier,
  }
}

async function getModel(): Promise<LocalModel> {
  if (!globalForReranker.__scourLocalReranker) {
    globalForReranker.__scourLocalReranker = loadModel().catch((error) => {
      globalForReranker.__scourLocalReranker = undefined
      globalForReranker.__scourLocalRerankerUnavailable = true
      throw error
    })
  }
  return globalForReranker.__scourLocalReranker
}

function documentFor(candidate: RerankCandidate): string {
  return [candidate.title, candidate.brand, candidate.details?.slice(0, 500)]
    .filter(Boolean)
    .join(' — ')
}

function sweepCache(cache: Map<string, CacheEntry>, now: number): void {
  for (const [key, value] of cache) {
    if (value.expiresAt <= now) cache.delete(key)
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) break
    cache.delete(oldest)
  }
}

/** Warm the cross-encoder without making server startup wait for it. */
export async function warmLocalReranker(): Promise<void> {
  if (process.env.LOCAL_RERANKER_DISABLED === '1') return
  await getModel()
}

/**
 * Score query-product pairs locally. Returns null when the optional model is
 * disabled or unavailable so callers can retain their existing fallback.
 */
export async function rerankCandidatesLocally(
  query: string,
  candidates: RerankCandidate[],
): Promise<RerankScores | null> {
  if (
    candidates.length === 0 ||
    process.env.LOCAL_RERANKER_DISABLED === '1' ||
    globalForReranker.__scourLocalRerankerUnavailable
  ) {
    return null
  }

  const now = Date.now()
  const cache = localRerankerCache()
  const scores: RerankScores = new Map()
  const pending: RerankCandidate[] = []
  for (const candidate of candidates) {
    const hit = cache.get(cacheKey(query, candidate))
    if (hit && hit.expiresAt > now) scores.set(candidate.id, hit.score)
    else pending.push(candidate)
  }
  if (pending.length === 0) return scores

  try {
    const { tokenizer, model } = await getModel()
    const inputs = tokenizer(
      pending.map(() => query),
      {
        text_pair: pending.map(documentFor),
        padding: true,
        truncation: true,
        max_length: 256,
      },
    )
    const output = await model(inputs)
    if (output.logits.data.length < pending.length) return null
    pending.forEach((candidate, index) => {
      const score = sigmoid(Number(output.logits.data[index]))
      scores.set(candidate.id, score)
      cache.set(cacheKey(query, candidate), {
        score,
        expiresAt: now + CACHE_TTL_MS,
      })
    })
    sweepCache(cache, now)
    return scores
  } catch (error) {
    console.warn('[local-reranker]', error instanceof Error ? error.message : error)
    return null
  }
}
