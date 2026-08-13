import type { SearchSpec } from './search-spec'

const VARIANT_SYNONYMS: Record<string, string[]> = {
  boots: ['chelsea boots', 'ankle boots', 'work boots'],
  shoes: ['footwear', 'sneakers'],
  headphones: ['over ear headphones', 'wireless headphones'],
  earbuds: ['true wireless earbuds', 'bluetooth earbuds'],
  chair: ['office chair', 'task chair', 'ergonomic chair'],
  desk: ['office desk', 'computer desk', 'writing desk'],
  monitor: ['computer monitor', 'display'],
  backpack: ['rucksack', 'daypack'],
  'game console': ['gaming console'],
}

const LEXICAL_NOISE = new Set([
  'a', 'an', 'and', 'best', 'buy', 'find', 'for', 'from', 'i', 'in', 'me',
  'my', 'need', 'of', 'on', 'or', 'please', 'the', 'to', 'want', 'with',
])

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !LEXICAL_NOISE.has(token))
}

export type LexicalDocument = {
  id: string
  text: string
}

/** Small, controlled recall variants; the literal query always remains first. */
export function buildQueryVariants(spec: SearchSpec, max = 4): string[] {
  const variants: string[] = []
  const add = (value: string | undefined) => {
    const normalized = normalizeSearchText(value ?? '')
    if (normalized && !variants.includes(normalized)) variants.push(normalized)
  }

  add(spec.refinedQuery || spec.rawQuery)
  if (spec.model) {
    add([spec.brand, spec.model, spec.productType].filter(Boolean).join(' '))
    return variants.slice(0, Math.max(1, max))
  }
  add([...spec.must, spec.brand, spec.productType].filter(Boolean).join(' '))
  for (const synonym of VARIANT_SYNONYMS[spec.productType ?? ''] ?? []) {
    add([...spec.must, spec.brand, synonym].filter(Boolean).join(' '))
  }
  return variants.slice(0, Math.max(1, max))
}

/** Fast per-document lexical evidence, normalized to [0,1] and model-token friendly. */
export function lexicalMatchScore(query: string, text: string): number {
  const queryNormalized = normalizeSearchText(query)
  const textNormalized = normalizeSearchText(text)
  if (!queryNormalized || !textNormalized) return 0
  const queryTokens = [...new Set(tokens(queryNormalized))]
  if (queryTokens.length === 0) return 0
  const textTokens = new Set(tokens(textNormalized))
  const matches = queryTokens.filter((token) => {
    if (textTokens.has(token)) return true
    if (token.endsWith('s') && textTokens.has(token.slice(0, -1))) return true
    return [...textTokens].some(
      (candidate) => candidate.endsWith('s') && candidate.slice(0, -1) === token,
    )
  })
  const coverage = matches.length / queryTokens.length
  const phrase = textNormalized.includes(queryNormalized) ? 1 : 0
  const compactQuery = queryNormalized.replace(/\s+/g, '')
  const compactText = textNormalized.replace(/\s+/g, '')
  const compact = compactQuery.length >= 4 && compactText.includes(compactQuery) ? 1 : 0
  return Math.min(1, coverage * 0.65 + phrase * 0.2 + compact * 0.15)
}

function lexicalTokenMatches(queryToken: string, documentToken: string): boolean {
  if (queryToken === documentToken) return true
  if (queryToken.endsWith('s') && queryToken.slice(0, -1) === documentToken) return true
  return documentToken.endsWith('s') && documentToken.slice(0, -1) === queryToken
}

/**
 * Rank a bounded catalogue with corpus-aware BM25. Unlike lexicalMatchScore,
 * this rewards rare model/category terms and normalizes long descriptions so
 * a keyword-stuffed product dump cannot dominate concise exact titles.
 */
export function bm25RankedIds(
  query: string,
  documents: ReadonlyArray<LexicalDocument>,
  options: { k1?: number; b?: number; floor?: number } = {},
): Map<string, number> {
  const queryTokens = [...new Set(tokens(query))]
  if (queryTokens.length === 0 || documents.length === 0) return new Map()

  const tokenized = documents.map((document) => ({
    id: document.id,
    tokens: tokens(document.text),
    normalized: normalizeSearchText(document.text),
  }))
  const averageLength = Math.max(
    1,
    tokenized.reduce((sum, document) => sum + document.tokens.length, 0) /
      tokenized.length,
  )
  const documentFrequency = new Map<string, number>()
  for (const queryToken of queryTokens) {
    const matches = tokenized.filter((document) =>
      document.tokens.some((documentToken) =>
        lexicalTokenMatches(queryToken, documentToken),
      ),
    ).length
    documentFrequency.set(queryToken, matches)
  }

  const k1 = Math.max(0.1, options.k1 ?? 1.2)
  const b = Math.max(0, Math.min(1, options.b ?? 0.75))
  const normalizedQuery = normalizeSearchText(query)
  const scores = tokenized.map((document) => {
    let score = 0
    for (const queryToken of queryTokens) {
      const termFrequency = document.tokens.filter((documentToken) =>
        lexicalTokenMatches(queryToken, documentToken),
      ).length
      if (termFrequency === 0) continue
      const df = documentFrequency.get(queryToken) ?? 0
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5))
      const lengthNormalization =
        termFrequency + k1 * (1 - b + b * (document.tokens.length / averageLength))
      score += idf * ((termFrequency * (k1 + 1)) / lengthNormalization)
    }
    if (normalizedQuery && document.normalized.includes(normalizedQuery)) score += 0.75
    return { id: document.id, score }
  })

  return rankedIds(scores, options.floor ?? 0)
}

export function rankedIds(
  scores: ReadonlyArray<{ id: string; score: number }>,
  floor = 0,
): Map<string, number> {
  return new Map(
    [...scores]
      .filter((item) => item.score > floor)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map((item, index) => [item.id, index + 1]),
  )
}
