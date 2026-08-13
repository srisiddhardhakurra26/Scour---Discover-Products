/**
 * Search ranking primitives kept independent from adapters and persistence.
 *
 * The pipeline is deliberately staged:
 *   1. fuse retrieval evidence into a base relevance score;
 *   2. collapse offers that identify the same product entity;
 *   3. reject weak candidates before diversity can influence ordering;
 *   4. greedily diversify the relevant set with MMR + aspect coverage;
 *   5. apply retailer/model exposure caps, relaxing them only to fill the rail.
 *
 * This module does not fetch data or call an LLM, so the same candidate set is
 * ranked deterministically and every displayed score can be explained.
 */

export type RetrievalChannelEvidence =
  | number
  | {
      rank: number
      /** Optional channel-native score, retained for diagnostics. */
      score?: number
    }

export type ProductIdentifiers = {
  canonicalId?: string
  gtin?: string
  upc?: string
  ean?: string
  asin?: string
  mpn?: string
}

export type SearchRankingCandidate = {
  id: string
  title: string
  source: string
  /** Rank (1 is best) in each independent retrieval channel. */
  channels?: Readonly<Record<string, RetrievalChannelEvidence>>
  /** Cosine or normalized semantic score. Values in [-1, 1] are accepted. */
  semanticScore?: number
  /** Normalized lexical/BM25 score. */
  lexicalScore?: number
  /** Product-specific relevance score, such as an ESCI exact/substitute score. */
  relevanceScore?: number
  /** Optional data-quality/merchant-authority signal. */
  qualityScore?: number
  embedding?: ReadonlyArray<number>
  brand?: string
  model?: string
  category?: string
  /** Facets worth covering for a broad query, e.g. "mesh" or "ergonomic". */
  aspects?: ReadonlyArray<string>
  identifiers?: ProductIdentifiers
  priceMinor?: number
}

export type HybridWeights = {
  rrf: number
  semantic: number
  lexical: number
  relevance: number
  quality: number
}

export type SearchRankingOptions = {
  query: string
  maxResults?: number
  /** 0 is broad/exploratory; 1 is an exact model/SKU query. */
  querySpecificity?: number
  rrfK?: number
  channelWeights?: Readonly<Record<string, number>>
  hybridWeights?: Partial<HybridWeights>
  /** Absolute base-relevance floor. */
  minRelevance?: number
  /** Maximum displayed entities represented primarily by one source. */
  maxPerSource?: number
  /** Maximum displayed variants from one explicitly identified model family. */
  maxPerModel?: number
  /** Override the dynamically selected MMR relevance weight. */
  diversityLambda?: number
}

export type ScoreExplanation = {
  rrf: number
  rrfContributions: Readonly<Record<string, number>>
  semantic?: number
  lexical?: number
  relevance?: number
  quality?: number
  hybridWeightsUsed: Readonly<Partial<HybridWeights>>
  baseRelevance: number
  relativeRelevanceGate: number
  diversityLambda: number
  maxSimilarityToSelected: number
  novelty: number
  aspectCoverageGain: number
  newlyCoveredAspects: readonly string[]
  capsRelaxed: readonly ('source' | 'model')[]
  finalScore: number
}

export type RankedSearchEntity<T extends SearchRankingCandidate = SearchRankingCandidate> = {
  rank: number
  candidate: T
  /** Stable product identity used to collapse duplicate retailer offers. */
  entityKey: string
  /** All offers collapsed into this entity, best representative first. */
  offers: readonly T[]
  sourceKeys: readonly string[]
  modelKey?: string
  score: ScoreExplanation
}

export type SearchRankingResult<T extends SearchRankingCandidate = SearchRankingCandidate> = {
  ranked: RankedSearchEntity<T>[]
  specificity: number
  diversityLambda: number
  relativeRelevanceGate: number
  droppedAsDuplicates: number
  droppedBelowRelevance: number
}

type BaseScore = {
  rrf: number
  rrfContributions: Record<string, number>
  semantic?: number
  lexical?: number
  relevance?: number
  quality?: number
  hybridWeightsUsed: Partial<HybridWeights>
  baseRelevance: number
}

type Entity<T extends SearchRankingCandidate> = {
  key: string
  representative: T
  offers: T[]
  sourceKeys: string[]
  modelKey?: string
  embedding?: ReadonlyArray<number>
  aspects: string[]
  base: BaseScore
}

const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  rrf: 0.4,
  semantic: 0.25,
  lexical: 0.12,
  relevance: 0.18,
  quality: 0.05,
}

const GENERIC_QUERY_WORDS = new Set([
  'bag',
  'boots',
  'camera',
  'chair',
  'desk',
  'dress',
  'headphones',
  'jacket',
  'keyboard',
  'laptop',
  'monitor',
  'mouse',
  'phone',
  'shoes',
  'speaker',
  'tablet',
  'television',
  'tv',
  'watch',
])

const TITLE_NOISE = new Set([
  'and',
  'at',
  'best',
  'buy',
  'deal',
  'for',
  'from',
  'in',
  'new',
  'of',
  'on',
  'sale',
  'the',
  'with',
])

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizedText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function titleTokens(title: string): string[] {
  return normalizedText(title)
    .split(' ')
    .filter((token) => token.length > 1 && !TITLE_NOISE.has(token))
}

function cleanIdentifier(value: string | undefined): string | undefined {
  const cleaned = normalizedText(value).replace(/\s+/g, '')
  return cleaned || undefined
}

function titleFingerprint(title: string): string {
  const tokens = titleTokens(title).filter(
    (token) =>
      !/^(?:used|refurbished|renewed|openbox|black|white|blue|red|green|silver|gold)$/.test(
        token,
      ),
  )
  return tokens.slice(0, 12).join('-') || normalizedText(title)
}

/** Resolve the strongest available product identity without fuzzy merging. */
export function canonicalProductKey(candidate: SearchRankingCandidate): string {
  const ids = candidate.identifiers ?? {}
  const canonical = cleanIdentifier(ids.canonicalId)
  if (canonical) return `canonical:${canonical}`

  for (const type of ['gtin', 'upc', 'ean', 'asin'] as const) {
    const value = cleanIdentifier(ids[type])
    if (value) return `${type}:${value}`
  }

  const brand = normalizedText(candidate.brand)
  const model = normalizedText(candidate.model) || cleanIdentifier(ids.mpn)
  if (model) return `model:${brand || 'unknown'}:${model}`

  // This conservative fallback catches repeated copies of the same normalized
  // title but intentionally avoids fuzzy-merging nearby models.
  return `title:${titleFingerprint(candidate.title)}`
}

/** A family key is used for exposure caps, not entity deduplication. */
export function productModelKey(
  candidate: SearchRankingCandidate,
): string | undefined {
  const model = normalizedText(candidate.model) || cleanIdentifier(candidate.identifiers?.mpn)
  if (!model) return undefined
  return `${normalizedText(candidate.brand) || 'unknown'}:${model}`
}

function channelRank(evidence: RetrievalChannelEvidence): number | undefined {
  const rank = typeof evidence === 'number' ? evidence : evidence.rank
  return Number.isFinite(rank) && rank > 0 ? rank : undefined
}

function normalizeSemantic(score: number | undefined): number | undefined {
  if (score === undefined || !Number.isFinite(score)) return undefined
  // Positive embedding scores in this app are already interpreted on [0, 1].
  // Map only negative cosine values into that range rather than shifting every
  // existing score upward.
  return clamp(score < 0 ? (score + 1) / 2 : score)
}

function mergeChannelRanks<T extends SearchRankingCandidate>(
  candidates: readonly T[],
): Record<string, RetrievalChannelEvidence> {
  const merged: Record<string, RetrievalChannelEvidence> = {}
  for (const candidate of candidates) {
    for (const [channel, evidence] of Object.entries(candidate.channels ?? {})) {
      const rank = channelRank(evidence)
      if (rank === undefined) continue
      const current = merged[channel]
      const currentRank = current === undefined ? undefined : channelRank(current)
      if (currentRank === undefined || rank < currentRank) merged[channel] = rank
    }
  }
  return merged
}

function maxDefined(
  candidates: readonly SearchRankingCandidate[],
  read: (candidate: SearchRankingCandidate) => number | undefined,
): number | undefined {
  let best: number | undefined
  for (const candidate of candidates) {
    const value = read(candidate)
    if (value === undefined || !Number.isFinite(value)) continue
    best = best === undefined ? value : Math.max(best, value)
  }
  return best
}

function hybridBaseScore(
  candidate: SearchRankingCandidate,
  options: SearchRankingOptions,
): BaseScore {
  const k = Math.max(1, options.rrfK ?? 60)
  const contributions: Record<string, number> = {}
  let rrfRaw = 0
  const rrfMax = Object.values(options.channelWeights ?? {}).reduce(
    (sum, weight) => sum + Math.max(0, weight) / (k + 1),
    0,
  )

  for (const [channel, evidence] of Object.entries(candidate.channels ?? {})) {
    const rank = channelRank(evidence)
    if (rank === undefined) continue
    const weight = Math.max(0, options.channelWeights?.[channel] ?? 1)
    if (weight === 0) continue
    const contribution = weight / (k + rank)
    contributions[channel] = contribution
    rrfRaw += contribution
  }

  const rrf = rrfMax > 0 ? clamp(rrfRaw / rrfMax) : 0
  const semantic = normalizeSemantic(candidate.semanticScore)
  const lexical =
    candidate.lexicalScore === undefined ? undefined : clamp(candidate.lexicalScore)
  const relevance =
    candidate.relevanceScore === undefined ? undefined : clamp(candidate.relevanceScore)
  const quality =
    candidate.qualityScore === undefined ? undefined : clamp(candidate.qualityScore)
  const configured = { ...DEFAULT_HYBRID_WEIGHTS, ...options.hybridWeights }
  const values: Partial<Record<keyof HybridWeights, number | undefined>> = {
    rrf: rrfMax > 0 ? rrf : undefined,
    semantic,
    lexical,
    relevance,
    quality,
  }

  let numerator = 0
  let denominator = 0
  const weightsUsed: Partial<HybridWeights> = {}
  for (const key of Object.keys(configured) as Array<keyof HybridWeights>) {
    const value = values[key]
    const weight = Math.max(0, configured[key])
    if (value === undefined || weight === 0) continue
    numerator += value * weight
    denominator += weight
    weightsUsed[key] = weight
  }

  return {
    rrf,
    rrfContributions: contributions,
    semantic,
    lexical,
    relevance,
    quality,
    hybridWeightsUsed: weightsUsed,
    baseRelevance: denominator > 0 ? clamp(numerator / denominator) : 0,
  }
}

function aggregateForEntity<T extends SearchRankingCandidate>(
  offers: T[],
  options: SearchRankingOptions,
): Entity<T> {
  const individuallyScored = offers
    .map((candidate) => ({ candidate, base: hybridBaseScore(candidate, options) }))
    .sort(
      (a, b) =>
        b.base.baseRelevance - a.base.baseRelevance ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
  const representative = individuallyScored[0].candidate
  const aggregateCandidate: SearchRankingCandidate = {
    ...representative,
    channels: mergeChannelRanks(offers),
    semanticScore: maxDefined(offers, (item) => item.semanticScore),
    lexicalScore: maxDefined(offers, (item) => item.lexicalScore),
    relevanceScore: maxDefined(offers, (item) => item.relevanceScore),
    qualityScore: maxDefined(offers, (item) => item.qualityScore),
  }

  const sourceKeys = [...new Set(offers.map((offer) => normalizedText(offer.source)))].filter(Boolean)
  const aspects = extractAspects(representative)
  const bestEmbedding = individuallyScored.find(
    ({ candidate }) => candidate.embedding && candidate.embedding.length > 0,
  )?.candidate.embedding

  return {
    key: canonicalProductKey(representative),
    representative,
    offers: individuallyScored.map(({ candidate }) => candidate),
    sourceKeys,
    modelKey: productModelKey(representative),
    embedding: bestEmbedding,
    aspects,
    base: hybridBaseScore(aggregateCandidate, options),
  }
}

function dedupeEntities<T extends SearchRankingCandidate>(
  candidates: readonly T[],
  options: SearchRankingOptions,
): Entity<T>[] {
  const groups = new Map<string, T[]>()
  for (const candidate of candidates) {
    const key = canonicalProductKey(candidate)
    const group = groups.get(key)
    if (group) group.push(candidate)
    else groups.set(key, [candidate])
  }
  return [...groups.values()].map((offers) => aggregateForEntity(offers, options))
}

function words(value: string): Set<string> {
  return new Set(titleTokens(value))
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

function cosine(
  left: ReadonlyArray<number> | undefined,
  right: ReadonlyArray<number> | undefined,
): number | undefined {
  if (!left || !right || left.length === 0 || left.length !== right.length) return undefined
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (leftNorm === 0 || rightNorm === 0) return undefined
  return clamp(dot / Math.sqrt(leftNorm * rightNorm))
}

function entitySimilarity<T extends SearchRankingCandidate>(
  left: Entity<T>,
  right: Entity<T>,
): number {
  if (left.modelKey && left.modelKey === right.modelKey) return 1
  const vectorSimilarity = cosine(left.embedding, right.embedding)
  const titleSimilarity = jaccard(
    words(left.representative.title),
    words(right.representative.title),
  )
  const aspectSimilarity = jaccard(new Set(left.aspects), new Set(right.aspects))
  if (vectorSimilarity === undefined) return clamp(0.75 * titleSimilarity + 0.25 * aspectSimilarity)
  return clamp(0.65 * vectorSimilarity + 0.25 * titleSimilarity + 0.1 * aspectSimilarity)
}

function priceBand(priceMinor: number | undefined): string | undefined {
  if (!priceMinor || priceMinor <= 0) return undefined
  if (priceMinor < 2_500) return 'price:entry'
  if (priceMinor < 10_000) return 'price:value'
  if (priceMinor < 30_000) return 'price:mid'
  if (priceMinor < 75_000) return 'price:premium'
  return 'price:luxury'
}

function extractAspects(candidate: SearchRankingCandidate): string[] {
  const values = [
    ...(candidate.aspects ?? []).map((aspect) => `facet:${normalizedText(aspect)}`),
    candidate.category ? `category:${normalizedText(candidate.category)}` : undefined,
    candidate.brand ? `brand:${normalizedText(candidate.brand)}` : undefined,
    priceBand(candidate.priceMinor),
  ]
  return [...new Set(values.filter((value): value is string => Boolean(value && !value.endsWith(':'))))]
}

/** Infer how much ranking should favor exact relevance over exploration. */
export function inferQuerySpecificity(query: string): number {
  const normalized = normalizedText(query)
  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length === 0) return 0.5

  let score = 0.15
  if (tokens.length >= 2) score += 0.1
  if (tokens.length >= 4) score += 0.15
  if (/["“”]/.test(query)) score += 0.25
  if (tokens.some((token) => /[a-z]+\d|\d+[a-z]+/.test(token))) score += 0.4
  if (tokens.some((token) => /^\d{4,}$/.test(token))) score += 0.25
  if (tokens.length === 1 && GENERIC_QUERY_WORDS.has(tokens[0])) score -= 0.12
  if (/\b(?:exact|model|sku|mpn|part number)\b/i.test(query)) score += 0.25
  return clamp(score)
}

function dynamicLambda(specificity: number): number {
  // Broad query: 64% relevance / 36% diversity. Exact query: up to 94%
  // relevance, keeping diversity as a tie-breaker rather than a steering force.
  return 0.64 + 0.3 * specificity
}

function dynamicRelativeGate(specificity: number): number {
  // A broad category can explore candidates down to 55% of the best base
  // score. Exact-model searches keep a much tighter relevance neighborhood.
  return 0.55 + 0.3 * specificity
}

function aspectGain(aspects: readonly string[], coverage: Map<string, number>): {
  gain: number
  newlyCovered: string[]
} {
  if (aspects.length === 0) return { gain: 0, newlyCovered: [] }
  const newlyCovered = aspects.filter((aspect) => !coverage.has(aspect))
  const gain =
    aspects.reduce((sum, aspect) => sum + 1 / (1 + (coverage.get(aspect) ?? 0)), 0) /
    aspects.length
  return { gain: clamp(gain), newlyCovered }
}

function capViolations<T extends SearchRankingCandidate>(
  entity: Entity<T>,
  sourceCounts: Map<string, number>,
  modelCounts: Map<string, number>,
  maxPerSource: number,
  maxPerModel: number,
): Array<'source' | 'model'> {
  const violations: Array<'source' | 'model'> = []
  const primarySource = normalizedText(entity.representative.source)
  if ((sourceCounts.get(primarySource) ?? 0) >= maxPerSource) violations.push('source')
  if (entity.modelKey && (modelCounts.get(entity.modelKey) ?? 0) >= maxPerModel) {
    violations.push('model')
  }
  return violations
}

type SelectionScore = {
  entity: Entity<SearchRankingCandidate>
  final: number
  maxSimilarity: number
  novelty: number
  aspectGain: number
  newlyCovered: string[]
}

function selectionScore<T extends SearchRankingCandidate>(
  entity: Entity<T>,
  selected: readonly Entity<T>[],
  coverage: Map<string, number>,
  lambda: number,
): Omit<SelectionScore, 'entity'> {
  const maxSimilarity = selected.reduce(
    (highest, picked) => Math.max(highest, entitySimilarity(entity, picked)),
    0,
  )
  const novelty = 1 - maxSimilarity
  const coverageResult = aspectGain(entity.aspects, coverage)
  // Split the diversity budget between individual novelty (MMR) and marginal
  // aspect coverage (xQuAD-style intent coverage).
  const diversityUtility = 0.6 * novelty + 0.4 * coverageResult.gain
  return {
    final: clamp(lambda * entity.base.baseRelevance + (1 - lambda) * diversityUtility),
    maxSimilarity,
    novelty,
    aspectGain: coverageResult.gain,
    newlyCovered: coverageResult.newlyCovered,
  }
}

function increment(map: Map<string, number>, key: string | undefined): void {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + 1)
}

/**
 * Rank candidates with weighted RRF, conservative product deduplication, and
 * relevance-gated diversity. The function is deterministic and side-effect free.
 */
export function rankSearchCandidates<T extends SearchRankingCandidate>(
  candidates: readonly T[],
  options: SearchRankingOptions,
): SearchRankingResult<T> {
  const maxResults = Math.max(0, Math.floor(options.maxResults ?? 24))
  const specificity = clamp(options.querySpecificity ?? inferQuerySpecificity(options.query))
  const lambda = clamp(options.diversityLambda ?? dynamicLambda(specificity))
  const relativeGate = dynamicRelativeGate(specificity)
  const minRelevance = clamp(options.minRelevance ?? 0.12)
  const maxPerSource = Math.max(1, Math.floor(options.maxPerSource ?? Math.max(2, Math.ceil(maxResults * 0.4))))
  const maxPerModel = Math.max(1, Math.floor(options.maxPerModel ?? 1))

  // Use a shared denominator for RRF normalization. Normalizing each candidate
  // only by the channels where it appeared would incorrectly make one first-
  // place occurrence stronger than corroborating top ranks across channels.
  const channelWeights: Record<string, number> = {}
  for (const candidate of candidates) {
    for (const channel of Object.keys(candidate.channels ?? {})) {
      channelWeights[channel] = options.channelWeights?.[channel] ?? 1
    }
  }
  for (const [channel, weight] of Object.entries(options.channelWeights ?? {})) {
    channelWeights[channel] = weight
  }
  const resolvedOptions = { ...options, channelWeights }

  const entities = dedupeEntities(candidates, resolvedOptions).sort(
    (left, right) =>
      right.base.baseRelevance - left.base.baseRelevance || left.key.localeCompare(right.key),
  )
  const absoluteRelevant = entities.filter((entity) => entity.base.baseRelevance >= minRelevance)
  const topBase = absoluteRelevant[0]?.base.baseRelevance ?? 0
  const diversityEligible = absoluteRelevant.filter(
    (entity) => entity.base.baseRelevance >= topBase * relativeGate,
  )
  const baseOnly = absoluteRelevant.filter((entity) => !diversityEligible.includes(entity))

  const selected: Entity<T>[] = []
  const explanations = new Map<string, Omit<ScoreExplanation, keyof BaseScore>>()
  const remaining = [...diversityEligible]
  const coverage = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  const modelCounts = new Map<string, number>()

  while (remaining.length > 0 && selected.length < maxResults) {
    const scored = remaining
      .map((entity) => ({
        entity,
        ...selectionScore(entity, selected, coverage, lambda),
      }))
      .sort(
        (left, right) =>
          right.final - left.final ||
          right.entity.base.baseRelevance - left.entity.base.baseRelevance ||
          left.entity.key.localeCompare(right.entity.key),
      )

    const withinCaps = scored.find(
      ({ entity }) =>
        capViolations(
          entity,
          sourceCounts,
          modelCounts,
          maxPerSource,
          maxPerModel,
        ).length === 0,
    )
    // Caps protect exposure while alternatives exist. If every remaining item
    // violates a cap, relax it so sparse searches still fill the result rail.
    const choice = withinCaps ?? scored[0]
    const relaxed = withinCaps
      ? []
      : capViolations(
          choice.entity,
          sourceCounts,
          modelCounts,
          maxPerSource,
          maxPerModel,
        )
    selected.push(choice.entity as Entity<T>)
    remaining.splice(remaining.indexOf(choice.entity as Entity<T>), 1)

    for (const aspect of choice.entity.aspects) increment(coverage, aspect)
    increment(sourceCounts, normalizedText(choice.entity.representative.source))
    increment(modelCounts, choice.entity.modelKey)
    explanations.set(choice.entity.key, {
      relativeRelevanceGate: relativeGate,
      diversityLambda: lambda,
      maxSimilarityToSelected: choice.maxSimilarity,
      novelty: choice.novelty,
      aspectCoverageGain: choice.aspectGain,
      newlyCoveredAspects: choice.newlyCovered,
      capsRelaxed: relaxed,
      finalScore: choice.final,
    })
  }

  // Candidates outside the relative diversity neighborhood remain ordered by
  // relevance. Diversification never promotes them over a closer match.
  for (const entity of baseOnly) {
    if (selected.length >= maxResults) break
    selected.push(entity)
    explanations.set(entity.key, {
      relativeRelevanceGate: relativeGate,
      diversityLambda: 1,
      maxSimilarityToSelected: 0,
      novelty: 0,
      aspectCoverageGain: 0,
      newlyCoveredAspects: [],
      capsRelaxed: [],
      finalScore: entity.base.baseRelevance,
    })
  }

  return {
    ranked: selected.map((entity, index) => ({
      rank: index + 1,
      candidate: entity.representative,
      entityKey: entity.key,
      offers: entity.offers,
      sourceKeys: entity.sourceKeys,
      modelKey: entity.modelKey,
      score: {
        ...entity.base,
        ...(explanations.get(entity.key) as Omit<ScoreExplanation, keyof BaseScore>),
      },
    })),
    specificity,
    diversityLambda: lambda,
    relativeRelevanceGate: relativeGate,
    droppedAsDuplicates: candidates.length - entities.length,
    droppedBelowRelevance: entities.length - absoluteRelevant.length,
  }
}
