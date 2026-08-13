export type SearchEvalIntent = 'product' | 'mission'

export type EsciLabel = 'exact' | 'substitute' | 'complement' | 'irrelevant'

export type RelevanceRule = {
  label: EsciLabel
  /** At least one normalized phrase must occur. */
  anyPhrases?: string[]
  /** Every normalized term must occur. */
  allTerms?: string[]
  /** A matching rule is rejected when any of these phrases occur. */
  nonePhrases?: string[]
}

export type SearchBenchmarkCase = {
  id: string
  query: string
  slices: string[]
  expectedIntent: SearchEvalIntent
  relevanceRules: RelevanceRule[]
  /** Expected inventory for the ideal DCG, independent of returned results. */
  idealRelevance: Partial<Record<EsciLabel, number>>
  constraints?: {
    minPriceMinor?: number
    maxPriceMinor?: number
    currency?: string
    requiredAnyPhrases?: string[]
    requiredAllTerms?: string[]
    forbiddenPhrases?: string[]
  }
  mission?: {
    composition: 'bundle' | 'alternatives'
    requiredSlots: Array<{
      id: string
      anyPhrases: string[]
    }>
  }
}

export type SearchBenchmark = {
  version: number
  frozenAt: string
  description: string
  cases: SearchBenchmarkCase[]
}

export type SearchEvaluationItem = {
  resultId: string
  entityId?: string
  title: string
  /** Optional retailer evidence used by the live hard-constraint gate. */
  evidence?: string
  source: string
  priceMinor?: number
  currency?: string
  /** An explicit human label wins over the benchmark's lexical rules. */
  relevance?: EsciLabel
  /** Set by mission runners when a result belongs to a planned slot. */
  slotId?: string
}

export type SearchEvaluationRun = {
  caseId: string
  runId?: string
  predictedIntent: SearchEvalIntent
  results: SearchEvaluationItem[]
  bundles?: Array<{
    id: string
    items: Array<{ resultId: string; slotId: string }>
  }>
}

export type SearchRunMetrics = {
  caseId: string
  runId?: string
  intentCorrect: boolean
  ndcgAt10: number
  precisionAt5: number
  constraintLeakageAt10: number
  duplicateRateAt10: number
  uniqueEntitiesAt10: number
  uniqueSourcesAt10: number
  /** Normalized source entropy: 0 is one source, 1 is maximal spread. */
  sourceDiversityAt10: number
  missionSlotCoverage: number | null
  completeBundleRate: number | null
  labelsAt10: EsciLabel[]
}

export type SearchMetricSummary = {
  runs: number
  intentAccuracy: number
  ndcgAt10: number
  precisionAt5: number
  constraintLeakageAt10: number
  duplicateRateAt10: number
  uniqueEntitiesAt10: number
  uniqueSourcesAt10: number
  sourceDiversityAt10: number
  missionSlotCoverage: number | null
  completeBundleRate: number | null
  repeatabilityAt10: number | null
}

export type SearchEvaluationReport = {
  benchmarkVersion: number
  summary: SearchMetricSummary
  bySlice: Record<string, SearchMetricSummary>
  perRun: SearchRunMetrics[]
  missingCaseIds: string[]
  unknownCaseIds: string[]
}

const LABEL_GAIN: Record<EsciLabel, number> = {
  exact: 3,
  substitute: 2,
  complement: 1,
  irrelevant: 0,
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const needle = normalized(phrase)
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `)
}

function includesTerm(haystack: string, expected: string): boolean {
  const needle = normalized(expected)
  if (!needle || needle.includes(' ')) return includesPhrase(haystack, needle)
  const variants = new Set([needle, `${needle}s`, `${needle}es`])
  if (needle.endsWith('y')) variants.add(`${needle.slice(0, -1)}ies`)
  return haystack.split(' ').some((token) => variants.has(token))
}

function ruleMatches(title: string, rule: RelevanceRule): boolean {
  const haystack = normalized(title)
  if (rule.nonePhrases?.some((phrase) => includesPhrase(haystack, phrase))) return false
  if (rule.anyPhrases?.length && !rule.anyPhrases.some((phrase) => includesPhrase(haystack, phrase))) {
    return false
  }
  if (rule.allTerms?.length && !rule.allTerms.every((term) => includesTerm(haystack, term))) {
    return false
  }
  return Boolean(rule.anyPhrases?.length || rule.allTerms?.length)
}

export function classifyEvaluationItem(
  benchmarkCase: SearchBenchmarkCase,
  item: SearchEvaluationItem,
): EsciLabel {
  if (item.relevance) return item.relevance
  const evidence = `${item.title} ${item.evidence ?? ''}`.trim()
  return benchmarkCase.relevanceRules.find((rule) => ruleMatches(evidence, rule))?.label ?? 'irrelevant'
}

function dcg(gains: number[]): number {
  return gains.reduce(
    (total, gain, index) => total + (2 ** gain - 1) / Math.log2(index + 2),
    0,
  )
}

function idealLabels(benchmarkCase: SearchBenchmarkCase, limit: number): EsciLabel[] {
  const labels: EsciLabel[] = []
  for (const label of ['exact', 'substitute', 'complement', 'irrelevant'] as const) {
    const count = Math.max(0, Math.floor(benchmarkCase.idealRelevance[label] ?? 0))
    for (let index = 0; index < count && labels.length < limit; index++) labels.push(label)
  }
  return labels
}

function ndcgAt(labels: EsciLabel[], ideal: EsciLabel[], limit: number): number {
  const actualDcg = dcg(labels.slice(0, limit).map((label) => LABEL_GAIN[label]))
  const idealDcg = dcg(ideal.slice(0, limit).map((label) => LABEL_GAIN[label]))
  return idealDcg > 0 ? Math.min(1, actualDcg / idealDcg) : 0
}

function violatesConstraints(
  item: SearchEvaluationItem,
  constraints: SearchBenchmarkCase['constraints'],
): boolean {
  if (!constraints) return false
  if (constraints.minPriceMinor != null && (item.priceMinor == null || item.priceMinor < constraints.minPriceMinor)) {
    return true
  }
  if (constraints.maxPriceMinor != null && (item.priceMinor == null || item.priceMinor > constraints.maxPriceMinor)) {
    return true
  }
  if (constraints.currency && item.currency !== constraints.currency) return true

  const title = normalized(`${item.title} ${item.evidence ?? ''}`)
  if (
    constraints.requiredAnyPhrases?.length &&
    !constraints.requiredAnyPhrases.some((phrase) => includesPhrase(title, phrase))
  ) {
    return true
  }
  if (
    constraints.requiredAllTerms?.length &&
    !constraints.requiredAllTerms.every((term) => includesTerm(title, term))
  ) {
    return true
  }
  return Boolean(
    constraints.forbiddenPhrases?.some((phrase) => includesPhrase(title, phrase)),
  )
}

function entityKey(item: SearchEvaluationItem): string {
  return item.entityId?.trim() ? `entity:${item.entityId.trim()}` : `title:${normalized(item.title)}`
}

function sourceDiversity(items: SearchEvaluationItem[]): number {
  if (items.length < 2) return 0
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  if (counts.size < 2) return 0
  const entropy = [...counts.values()].reduce((total, count) => {
    const probability = count / items.length
    return total - probability * Math.log(probability)
  }, 0)
  // The maximum occurs when every returned item is from a different source.
  return entropy / Math.log(items.length)
}

function slotForItem(
  item: SearchEvaluationItem,
  benchmarkCase: SearchBenchmarkCase,
): string | undefined {
  const expected = benchmarkCase.mission?.requiredSlots
  if (!expected) return undefined
  if (item.slotId && expected.some((slot) => slot.id === item.slotId)) return item.slotId
  const title = normalized(item.title)
  return expected.find((slot) =>
    slot.anyPhrases.some((phrase) => includesPhrase(title, phrase)),
  )?.id
}

function missionMetrics(
  benchmarkCase: SearchBenchmarkCase,
  run: SearchEvaluationRun,
): Pick<SearchRunMetrics, 'missionSlotCoverage' | 'completeBundleRate'> {
  const requiredSlots = benchmarkCase.mission?.requiredSlots
  if (!requiredSlots?.length) {
    return { missionSlotCoverage: null, completeBundleRate: null }
  }

  if (benchmarkCase.mission?.composition === 'alternatives') {
    const covered = new Set<string>()
    for (const item of run.results) {
      const slot = slotForItem(item, benchmarkCase)
      if (slot) covered.add(slot)
    }
    return {
      missionSlotCoverage: covered.size / requiredSlots.length,
      completeBundleRate: null,
    }
  }

  const covered = new Set<string>()
  for (const item of run.results) {
    const slot = slotForItem(item, benchmarkCase)
    if (slot) covered.add(slot)
  }

  const required = new Set(requiredSlots.map((slot) => slot.id))
  const bundles = run.bundles ?? []
  const completeBundles = bundles.filter((bundle) => {
    const slots = new Set(bundle.items.map((item) => item.slotId))
    return requiredSlots.every((slot) => slots.has(slot.id)) && slots.size === required.size
  }).length

  return {
    missionSlotCoverage: covered.size / required.size,
    completeBundleRate: bundles.length > 0 ? completeBundles / bundles.length : 0,
  }
}

export function evaluateSearchRun(
  benchmarkCase: SearchBenchmarkCase,
  run: SearchEvaluationRun,
): SearchRunMetrics {
  const top10 = run.results.slice(0, 10)
  const labels = top10.map((item) => classifyEvaluationItem(benchmarkCase, item))
  const top5Labels = labels.slice(0, 5)
  const uniqueEntities = new Set(top10.map(entityKey))
  const constraintViolations = top10.filter((item) =>
    violatesConstraints(item, benchmarkCase.constraints),
  ).length

  return {
    caseId: benchmarkCase.id,
    runId: run.runId,
    intentCorrect: benchmarkCase.expectedIntent === run.predictedIntent,
    ndcgAt10: ndcgAt(labels, idealLabels(benchmarkCase, 10), 10),
    precisionAt5:
      top5Labels.filter((label) => label === 'exact' || label === 'substitute').length / 5,
    constraintLeakageAt10: top10.length > 0 ? constraintViolations / top10.length : 0,
    duplicateRateAt10: top10.length > 0 ? (top10.length - uniqueEntities.size) / top10.length : 0,
    uniqueEntitiesAt10: uniqueEntities.size,
    uniqueSourcesAt10: new Set(top10.map((item) => item.source)).size,
    sourceDiversityAt10: sourceDiversity(top10),
    ...missionMetrics(benchmarkCase, run),
    labelsAt10: labels,
  }
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function meanNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null)
  return present.length > 0 ? mean(present) : null
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 1
  let intersection = 0
  for (const value of left) if (right.has(value)) intersection++
  return intersection / union.size
}

function repeatabilityForRuns(runs: SearchEvaluationRun[]): number | null {
  if (runs.length < 2) return null
  const scores: number[] = []
  for (let left = 0; left < runs.length; left++) {
    for (let right = left + 1; right < runs.length; right++) {
      scores.push(
        jaccard(
          new Set(runs[left].results.slice(0, 10).map(entityKey)),
          new Set(runs[right].results.slice(0, 10).map(entityKey)),
        ),
      )
    }
  }
  return mean(scores)
}

function summarize(
  metrics: SearchRunMetrics[],
  runs: SearchEvaluationRun[],
): SearchMetricSummary {
  const repeatability = new Map<string, SearchEvaluationRun[]>()
  for (const run of runs) {
    const existing = repeatability.get(run.caseId) ?? []
    existing.push(run)
    repeatability.set(run.caseId, existing)
  }
  const repeatabilityScores = [...repeatability.values()]
    .map(repeatabilityForRuns)
    .filter((value): value is number => value != null)

  return {
    runs: metrics.length,
    intentAccuracy: mean(metrics.map((metric) => Number(metric.intentCorrect))),
    ndcgAt10: mean(metrics.map((metric) => metric.ndcgAt10)),
    precisionAt5: mean(metrics.map((metric) => metric.precisionAt5)),
    constraintLeakageAt10: mean(metrics.map((metric) => metric.constraintLeakageAt10)),
    duplicateRateAt10: mean(metrics.map((metric) => metric.duplicateRateAt10)),
    uniqueEntitiesAt10: mean(metrics.map((metric) => metric.uniqueEntitiesAt10)),
    uniqueSourcesAt10: mean(metrics.map((metric) => metric.uniqueSourcesAt10)),
    sourceDiversityAt10: mean(metrics.map((metric) => metric.sourceDiversityAt10)),
    missionSlotCoverage: meanNullable(metrics.map((metric) => metric.missionSlotCoverage)),
    completeBundleRate: meanNullable(metrics.map((metric) => metric.completeBundleRate)),
    repeatabilityAt10: repeatabilityScores.length > 0 ? mean(repeatabilityScores) : null,
  }
}

export function validateSearchBenchmark(value: unknown): asserts value is SearchBenchmark {
  if (!value || typeof value !== 'object') throw new Error('Benchmark must be an object')
  const benchmark = value as Partial<SearchBenchmark>
  if (!Number.isInteger(benchmark.version) || !Array.isArray(benchmark.cases)) {
    throw new Error('Benchmark requires an integer version and cases array')
  }
  const ids = new Set<string>()
  for (const entry of benchmark.cases) {
    if (!entry?.id || !entry.query || !Array.isArray(entry.slices)) {
      throw new Error('Every benchmark case requires id, query, and slices')
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate benchmark case id: ${entry.id}`)
    ids.add(entry.id)
    if (!['product', 'mission'].includes(entry.expectedIntent)) {
      throw new Error(`Invalid expected intent for ${entry.id}`)
    }
    if (!Array.isArray(entry.relevanceRules) || !entry.idealRelevance) {
      throw new Error(`Missing relevance judgments for ${entry.id}`)
    }
    if (entry.expectedIntent === 'mission' && !entry.mission?.requiredSlots.length) {
      throw new Error(`Mission case ${entry.id} requires expected slots`)
    }
  }
}

export function evaluateSearchBenchmark(
  benchmark: SearchBenchmark,
  runs: SearchEvaluationRun[],
): SearchEvaluationReport {
  validateSearchBenchmark(benchmark)
  const cases = new Map(benchmark.cases.map((entry) => [entry.id, entry]))
  const knownRuns = runs.filter((run) => cases.has(run.caseId))
  const perRun = knownRuns.map((run) => evaluateSearchRun(cases.get(run.caseId)!, run))
  const unknownCaseIds = [...new Set(runs.filter((run) => !cases.has(run.caseId)).map((run) => run.caseId))]
  const suppliedIds = new Set(knownRuns.map((run) => run.caseId))
  const missingCaseIds = benchmark.cases.filter((entry) => !suppliedIds.has(entry.id)).map((entry) => entry.id)
  const bySlice: Record<string, SearchMetricSummary> = {}
  const slices = new Set(
    benchmark.cases
      .filter((entry) => suppliedIds.has(entry.id))
      .flatMap((entry) => entry.slices),
  )
  for (const slice of [...slices].sort()) {
    const caseIds = new Set(benchmark.cases.filter((entry) => entry.slices.includes(slice)).map((entry) => entry.id))
    const sliceRuns = knownRuns.filter((run) => caseIds.has(run.caseId))
    const sliceMetrics = perRun.filter((metric) => caseIds.has(metric.caseId))
    bySlice[slice] = summarize(sliceMetrics, sliceRuns)
  }

  return {
    benchmarkVersion: benchmark.version,
    summary: summarize(perRun, knownRuns),
    bySlice,
    perRun,
    missingCaseIds,
    unknownCaseIds,
  }
}
