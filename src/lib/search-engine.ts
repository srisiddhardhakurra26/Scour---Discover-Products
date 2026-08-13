import type { Adapter, NormalizedListing } from '@/lib/adapters/types'
import { prisma } from '@/lib/db'
import { bytesToFloat, dotProduct, embedQueryCached, EMBEDDING_DIM } from '@/lib/embeddings'
import { searchAllAdapters, type AdapterSearchResult } from '@/lib/fanout'
import { parseQuery } from '@/lib/llm/query-parser'
import { rerankCandidates } from '@/lib/llm/rerank'
import { rerankCandidatesLocally } from '@/lib/local-reranker'
import {
  rankSearchCandidates,
  type RankedSearchEntity,
  type SearchRankingCandidate,
} from '@/lib/search-ranking'
import {
  bm25RankedIds,
  buildQueryVariants,
  lexicalMatchScore,
  rankedIds,
} from '@/lib/search-retrieval'
import {
  buildSearchSpec,
  classifyProductRole,
  type ProductRole,
  type ProductRoleDecision,
  type SearchSpec,
} from '@/lib/search-spec'
import {
  privacySafeSearchDiagnostics,
  recordSearchRun,
} from '@/lib/search-telemetry'
import { extractASIN, normalizeTitle } from '@/lib/text'

const LOCAL_CATALOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const LOCAL_CATALOG_LIMIT = 2_000
const LLM_RERANK_LIMIT = 48
const RESULT_LIMIT = 30

const ASPECT_WORDS = [
  'ankle', 'chelsea', 'compact', 'ergonomic', 'executive', 'gaming', 'hiking',
  'leather', 'lightweight', 'mechanical', 'mesh', 'portable', 'quiet', 'running',
  'standing', 'suede', 'waterproof', 'wireless', 'work',
]

export type SearchEngineCandidate = SearchRankingCandidate & {
  listing: NormalizedListing
  adapter: Adapter
  role: ProductRole
  roleDecision: ProductRoleDecision
  fromCache: boolean
}

export type SearchProduct = RankedSearchEntity<SearchEngineCandidate>

export type SearchDiagnostics = {
  variants: string[]
  liveCandidates: number
  catalogCandidates: number
  eligibleCandidates: number
  localReranked: number
  llmReranked: number
  duplicateOffersCollapsed: number
  droppedBelowRelevance: number
  sources: Array<{
    id: string
    label: string
    rawCount: number
    keptCount: number
    elapsedMs: number
    failed: boolean
    fromCache: boolean
  }>
}

export type ProductSearchResult = {
  query: string
  spec: SearchSpec
  products: SearchProduct[]
  searchRunId: string | null
  candidateCount: number
  storesSearched: number
  storesHit: number
  elapsedMs: number
  diagnostics: SearchDiagnostics
}

type MutableCandidate = SearchEngineCandidate & {
  channels: Record<string, number>
}

type CatalogRow = {
  retailerId: string
  externalId: string
  title: string
  url: string
  imageUrl: string | null
  priceMinor: number
  currency: string
  shippingMinor: number | null
  availability: string | null
  sellerName: string | null
  sellerRating: number | null
  reviewCount: number | null
  reviewAvg: number | null
  detailsText: string | null
  ocrText: string | null
  textEmbedding: Uint8Array | null
}

function listingText(listing: NormalizedListing): string {
  return `${normalizeTitle(listing.title)} ${listing.detailsText ?? ''}`.trim()
}

function includesNormalized(text: string, value: string | undefined): boolean {
  if (!value) return false
  const compact = (input: string) => input.toLowerCase().replace(/[^a-z0-9]/g, '')
  return compact(text).includes(compact(value))
}

function extractListingModel(title: string, spec: SearchSpec): string | undefined {
  if (spec.model && includesNormalized(title, spec.model)) return spec.model
  const mixed = title.match(
    /\b(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+\b/i,
  )?.[0]
  if (mixed) return mixed.toUpperCase()
  if (spec.brand && includesNormalized(title, spec.brand)) {
    const afterBrand = title.match(
      new RegExp(`\\b${spec.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d{2,5})\\b`, 'i'),
    )?.[1]
    if (afterBrand) return afterBrand
  }
  return undefined
}

function listingAspects(listing: NormalizedListing): string[] {
  const haystack = ` ${listingText(listing).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  return ASPECT_WORDS.filter((word) => haystack.includes(` ${word} `))
}

function qualityScore(listing: NormalizedListing, fromCache: boolean): number {
  let score = fromCache ? 0.35 : 0.55
  if (listing.priceMinor > 0) score += 0.12
  if (listing.imageUrl) score += 0.08
  if (listing.availability === 'in_stock') score += 0.1
  if (listing.availability === 'out') score -= 0.35
  if ((listing.reviewCount ?? 0) >= 10) score += 0.05
  if ((listing.reviewAvg ?? 0) >= 4) score += 0.05
  return Math.max(0, Math.min(1, score))
}

function normalizedListing(row: CatalogRow): NormalizedListing {
  return {
    externalId: row.externalId,
    title: row.title,
    url: row.url,
    imageUrl: row.imageUrl ?? undefined,
    priceMinor: row.priceMinor,
    currency: row.currency,
    shippingMinor: row.shippingMinor ?? undefined,
    availability: (row.availability as NormalizedListing['availability']) ?? undefined,
    sellerName: row.sellerName ?? undefined,
    sellerRating: row.sellerRating ?? undefined,
    reviewCount: row.reviewCount ?? undefined,
    reviewAvg: row.reviewAvg ?? undefined,
    detailsText: [row.detailsText, row.ocrText].filter(Boolean).join('\n') || undefined,
  }
}

async function loadCatalog(adapterIds: string[]): Promise<CatalogRow[]> {
  if (adapterIds.length === 0) return []
  return prisma.listing.findMany({
    where: {
      retailerId: { in: adapterIds },
      lastSeenAt: { gte: new Date(Date.now() - LOCAL_CATALOG_MAX_AGE_MS) },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: LOCAL_CATALOG_LIMIT,
    select: {
      retailerId: true,
      externalId: true,
      title: true,
      url: true,
      imageUrl: true,
      priceMinor: true,
      currency: true,
      shippingMinor: true,
      availability: true,
      sellerName: true,
      sellerRating: true,
      reviewCount: true,
      reviewAvg: true,
      detailsText: true,
      ocrText: true,
      textEmbedding: true,
    },
  })
}

function selectBalancedForJudge(candidates: MutableCandidate[]): MutableCandidate[] {
  const ordered = [...candidates].sort(
    (left, right) =>
      (right.relevanceScore ?? 0) + (right.semanticScore ?? 0) + (right.lexicalScore ?? 0) -
      ((left.relevanceScore ?? 0) + (left.semanticScore ?? 0) + (left.lexicalScore ?? 0)),
  )
  const selected: MutableCandidate[] = []
  const counts = new Map<string, number>()
  for (const candidate of ordered) {
    if ((counts.get(candidate.source) ?? 0) >= 8) continue
    selected.push(candidate)
    counts.set(candidate.source, (counts.get(candidate.source) ?? 0) + 1)
    if (selected.length >= LLM_RERANK_LIMIT) break
  }
  return selected
}

function sanitizedSpec(spec: SearchSpec) {
  return {
    kind: spec.kind,
    targetCount: spec.targets.length,
    productType: spec.productType,
    hasBrand: Boolean(spec.brand),
    hasModel: Boolean(spec.model),
    mustCount: spec.must.length,
    exclusionCount: spec.mustNot.length,
    compatibilityCount: spec.compatibility.length,
    condition: spec.condition,
    hasMinPrice: spec.minPriceMinor !== undefined,
    hasMaxPrice: spec.maxPriceMinor !== undefined,
    confidence: spec.confidence,
  }
}

function buildCandidate(input: {
  adapter: Adapter
  listing: NormalizedListing
  embedding?: Float32Array
  fromCache: boolean
  spec: SearchSpec
  variants: string[]
  queryVectors: Float32Array[]
}): MutableCandidate | null {
  const { adapter, listing, embedding, fromCache, spec, variants, queryVectors } = input
  const id = `${adapter.id}:${listing.externalId}`
  const text = listingText(listing)
  const lexicalScores = variants.map((variant) => lexicalMatchScore(variant, text))
  const semanticScores = embedding && embedding.length === EMBEDDING_DIM
    ? queryVectors.map((vector) => dotProduct(vector, embedding))
    : []
  const lexicalScore = Math.max(0, ...lexicalScores)
  const semanticScore = Math.max(0, ...semanticScores)
  let roleDecision = classifyProductRole(spec, listing)

  // Unknown/typo-heavy queries have no safe product-type gate. Admit only a
  // strong lexical+semantic candidate and let the later relevance floor rank
  // it; known types and explicit constraints never receive this escape hatch.
  if (
    !roleDecision.eligible &&
    !spec.productType &&
    roleDecision.confidence <= 0.7 &&
    ((semanticScore >= 0.38 && lexicalScore >= 0.2) || lexicalScore >= 0.62)
  ) {
    roleDecision = {
      role: 'substitute',
      eligible: true,
      confidence: 0.62,
      reasons: ['strong hybrid match for an untyped query'],
    }
  }
  if (!roleDecision.eligible) return null

  const brand = spec.brand && includesNormalized(text, spec.brand) ? spec.brand : undefined
  const model = extractListingModel(listing.title, spec)
  return {
    id,
    title: listing.title,
    source: adapter.id,
    channels: {},
    semanticScore,
    lexicalScore,
    relevanceScore: roleDecision.role === 'exact' ? 0.95 : 0.72,
    qualityScore: qualityScore(listing, fromCache),
    embedding: embedding as unknown as ReadonlyArray<number> | undefined,
    brand,
    model,
    category: spec.productType,
    aspects: listingAspects(listing),
    identifiers: { asin: extractASIN(listing.url) ?? undefined },
    priceMinor: listing.priceMinor,
    listing,
    adapter,
    role: roleDecision.role,
    roleDecision,
    fromCache,
  }
}

function addRankChannel(
  candidates: MutableCandidate[],
  channel: string,
  ranks: Map<string, number>,
) {
  for (const candidate of candidates) {
    const rank = ranks.get(candidate.id)
    if (rank) candidate.channels[channel] = rank
  }
}

export async function searchProducts(input: {
  query: string
  adapters: Adapter[]
  timeoutMs: number
  persist?: boolean
  telemetry?: boolean
  maxResults?: number
}): Promise<ProductSearchResult> {
  const started = performance.now()
  const query = input.query.trim().slice(0, 500)
  const spec = buildSearchSpec(query)
  const variants = buildQueryVariants(spec)
  const adapterMap = new Map(input.adapters.map((adapter) => [adapter.id, adapter]))
  const [adapterResults, catalogRows, queryVectors] = await Promise.all([
    searchAllAdapters(input.adapters, query, input.timeoutMs, {
      persist: input.persist,
    }),
    loadCatalog(input.adapters.map((adapter) => adapter.id)),
    Promise.all(variants.map((variant) => embedQueryCached(variant))),
  ])

  const byId = new Map<string, MutableCandidate>()
  let liveCandidates = 0
  for (const result of adapterResults) {
    for (const item of result.kept) {
      liveCandidates += 1
      const candidate = buildCandidate({
        adapter: result.adapter,
        listing: item.listing,
        embedding: item.embedding,
        fromCache: result.fromCache,
        spec,
        variants,
        queryVectors,
      })
      if (!candidate) continue
      candidate.channels[`native:${result.adapter.id}`] =
        result.kept.findIndex((ranked) => ranked.listing.externalId === item.listing.externalId) + 1
      byId.set(candidate.id, candidate)
    }
  }

  let catalogCandidates = 0
  for (const row of catalogRows) {
    const adapter = adapterMap.get(row.retailerId)
    if (!adapter) continue
    const id = `${adapter.id}:${row.externalId}`
    if (byId.has(id)) continue
    const embedding = row.textEmbedding ? bytesToFloat(row.textEmbedding) : undefined
    const candidate = buildCandidate({
      adapter,
      listing: normalizedListing(row),
      embedding,
      fromCache: true,
      spec,
      variants,
      queryVectors,
    })
    if (!candidate) continue
    byId.set(id, candidate)
    catalogCandidates += 1
  }

  let candidates = [...byId.values()]
  // When a shopper names a brand/model and inventory contains a full first
  // page of exact matches, keep substitutes out of the main rail. This avoids
  // diversity promoting a different brand above abundant requested products;
  // substitutes still rescue sparse exact searches.
  if (spec.brand || spec.model) {
    const exactCandidates = candidates.filter((candidate) => candidate.role === 'exact')
    if (
      exactCandidates.length > 0 &&
      (Boolean(spec.model) || exactCandidates.length >= Math.min(input.maxResults ?? RESULT_LIMIT, 10))
    ) {
      candidates = exactCandidates
    }
  }
  const lexicalDocuments = candidates.map((candidate) => ({
    id: candidate.id,
    text: listingText(candidate.listing),
  }))
  addRankChannel(
    candidates,
    'lexical:literal',
    bm25RankedIds(variants[0], lexicalDocuments),
  )
  addRankChannel(
    candidates,
    'lexical:expanded',
    variants.length > 1
      ? bm25RankedIds(variants.slice(1).join(' '), lexicalDocuments)
      : new Map(),
  )
  addRankChannel(
    candidates,
    'semantic',
    rankedIds(candidates.map((candidate) => ({ id: candidate.id, score: candidate.semanticScore ?? 0 })), 0.15),
  )

  let localReranked = 0
  let llmReranked = 0
  if (candidates.length > 1) {
    const judged = selectBalancedForJudge(candidates)
    const judgeCandidates = judged.map((candidate) => ({
      id: candidate.id,
      title: candidate.listing.title,
      brand: candidate.brand,
      priceMinor: candidate.listing.priceMinor,
      currency: candidate.listing.currency,
      details: candidate.listing.detailsText,
    }))
    let scores = await rerankCandidatesLocally(spec.refinedQuery || query, judgeCandidates)
    const usedLocalReranker = scores !== null
    if (!scores) {
      const parsed = await parseQuery(query)
      scores = await rerankCandidates(query, parsed, judgeCandidates)
    }
    if (scores) {
      for (const candidate of judged) {
        const score = scores.get(candidate.id)
        if (score === undefined) continue
        // The model is an auxiliary signal. Deterministic constraints and the
        // hybrid base remain authoritative during outages or score drift.
        candidate.relevanceScore =
          (candidate.relevanceScore ?? 0.7) * 0.65 + Math.max(0, Math.min(1, score)) * 0.35
        if (usedLocalReranker) localReranked += 1
        else llmReranked += 1
      }
    }
  }

  const channelWeights: Record<string, number> = {
    'lexical:literal': 2.2,
    'lexical:expanded': 0.75,
    semantic: 1,
  }
  for (const adapter of input.adapters) channelWeights[`native:${adapter.id}`] = 1.35
  const ranked = rankSearchCandidates(candidates, {
    query,
    maxResults: input.maxResults ?? RESULT_LIMIT,
    channelWeights,
    maxPerSource: 8,
    maxPerModel: 1,
    minRelevance: 0.2,
  })

  const elapsedMs = Math.round(performance.now() - started)
  const diagnostics: SearchDiagnostics = {
    variants,
    liveCandidates,
    catalogCandidates,
    eligibleCandidates: candidates.length,
    localReranked,
    llmReranked,
    duplicateOffersCollapsed: ranked.droppedAsDuplicates,
    droppedBelowRelevance: ranked.droppedBelowRelevance,
    sources: adapterResults.map((result: AdapterSearchResult) => ({
      id: result.adapter.id,
      label: result.adapter.label,
      rawCount: result.rawCount,
      keptCount: result.kept.length,
      elapsedMs: result.elapsedMs,
      failed: result.failed,
      fromCache: result.fromCache,
    })),
  }
  const searchRunId = input.telemetry === false
    ? null
    : await recordSearchRun({
        query,
        intent: spec.kind,
        spec: sanitizedSpec(spec),
        candidateCount: liveCandidates + catalogRows.length,
        resultCount: ranked.ranked.length,
        sourceCount: input.adapters.length,
        failedSourceCount: adapterResults.filter((result) => result.failed).length,
        latencyMs: elapsedMs,
        diagnostics: privacySafeSearchDiagnostics(
          diagnostics as unknown as Record<string, unknown>,
        ),
      })

  return {
    query,
    spec,
    products: ranked.ranked,
    searchRunId,
    candidateCount: liveCandidates + catalogRows.length,
    storesSearched: input.adapters.length,
    storesHit: new Set(ranked.ranked.flatMap((product) => product.sourceKeys)).size,
    elapsedMs,
    diagnostics,
  }
}
