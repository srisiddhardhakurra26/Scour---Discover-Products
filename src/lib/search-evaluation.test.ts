import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import {
  classifyEvaluationItem,
  evaluateSearchBenchmark,
  evaluateSearchRun,
  validateSearchBenchmark,
  type SearchBenchmark,
  type SearchBenchmarkCase,
  type SearchEvaluationRun,
} from './search-evaluation'

const productCase: SearchBenchmarkCase = {
  id: 'headphones',
  query: 'wireless headphones under $100',
  slices: ['product', 'budget'],
  expectedIntent: 'product',
  relevanceRules: [
    { label: 'exact', allTerms: ['wireless', 'headphones'], nonePhrases: ['case'] },
    { label: 'substitute', anyPhrases: ['bluetooth headphones'] },
    { label: 'complement', anyPhrases: ['headphone case'] },
  ],
  idealRelevance: { exact: 7, substitute: 3 },
  constraints: { maxPriceMinor: 10000, currency: 'USD' },
}

test('classifies results with ordered ESCI-style rules and explicit overrides', () => {
  assert.equal(
    classifyEvaluationItem(productCase, {
      resultId: '1',
      title: 'Wireless Headphones with ANC',
      source: 'Amazon',
    }),
    'exact',
  )
  assert.equal(
    classifyEvaluationItem(
      {
        ...productCase,
        relevanceRules: [{ label: 'exact', allTerms: ['leather', 'boot'] }],
      },
      {
        resultId: '5',
        title: 'Heritage Boots #159',
        evidence: 'Premium full-grain leather upper',
        source: 'Brand store',
      },
    ),
    'exact',
  )
  assert.equal(
    classifyEvaluationItem(productCase, {
      resultId: '2',
      title: 'Wireless Headphone Case',
      source: 'eBay',
    }),
    'complement',
  )
  assert.equal(
    classifyEvaluationItem(productCase, {
      resultId: '3',
      title: 'Unrecognized title',
      source: 'eBay',
      relevance: 'substitute',
    }),
    'substitute',
  )
  assert.equal(
    classifyEvaluationItem(
      {
        ...productCase,
        relevanceRules: [{ label: 'exact', allTerms: ['leather', 'boot'] }],
      },
      {
        resultId: '4',
        title: 'Premium Leather Boots',
        source: 'eBay',
      },
    ),
    'exact',
  )
})

test('calculates relevance, leakage, entity duplication, and source diversity', () => {
  const metrics = evaluateSearchRun(productCase, {
    caseId: productCase.id,
    predictedIntent: 'product',
    results: [
      {
        resultId: '1',
        entityId: 'sony-1',
        title: 'Wireless Headphones with ANC',
        source: 'Amazon',
        priceMinor: 9999,
        currency: 'USD',
      },
      {
        resultId: '2',
        entityId: 'sony-1',
        title: 'Wireless Headphones with ANC',
        source: 'eBay',
        priceMinor: 10999,
        currency: 'USD',
      },
      {
        resultId: '3',
        title: 'Bluetooth Headphones',
        source: 'Best Buy',
        priceMinor: 7999,
        currency: 'USD',
      },
      {
        resultId: '4',
        title: 'Headphone Case',
        source: 'Amazon',
        priceMinor: 1200,
        currency: 'USD',
      },
      {
        resultId: '5',
        title: 'Coffee Grinder',
        source: 'eBay',
        priceMinor: 4500,
        currency: 'USD',
      },
    ],
  })

  assert.equal(metrics.intentCorrect, true)
  assert.equal(metrics.precisionAt5, 0.6)
  assert.equal(metrics.constraintLeakageAt10, 0.2)
  assert.equal(metrics.duplicateRateAt10, 0.2)
  assert.equal(metrics.uniqueEntitiesAt10, 4)
  assert.equal(metrics.uniqueSourcesAt10, 3)
  assert.ok(metrics.sourceDiversityAt10 > 0.5 && metrics.sourceDiversityAt10 < 1)
  assert.ok(metrics.ndcgAt10 > 0 && metrics.ndcgAt10 < 1)
})

test('calculates mission slot coverage and complete package rate', () => {
  const missionCase: SearchBenchmarkCase = {
    id: 'office',
    query: 'furnish an office',
    slices: ['mission'],
    expectedIntent: 'mission',
    relevanceRules: [{ label: 'exact', anyPhrases: ['desk', 'chair', 'lamp'] }],
    idealRelevance: { exact: 10 },
    mission: {
      composition: 'bundle',
      requiredSlots: [
        { id: 'desk', anyPhrases: ['desk'] },
        { id: 'chair', anyPhrases: ['chair'] },
        { id: 'light', anyPhrases: ['lamp'] },
      ],
    },
  }
  const metrics = evaluateSearchRun(missionCase, {
    caseId: missionCase.id,
    predictedIntent: 'mission',
    results: [
      { resultId: 'desk-1', title: 'Office Desk', source: 'A', slotId: 'desk' },
      { resultId: 'chair-1', title: 'Ergonomic Chair', source: 'B', slotId: 'chair' },
    ],
    bundles: [
      {
        id: 'incomplete',
        items: [
          { resultId: 'desk-1', slotId: 'desk' },
          { resultId: 'chair-1', slotId: 'chair' },
        ],
      },
      {
        id: 'complete',
        items: [
          { resultId: 'desk-1', slotId: 'desk' },
          { resultId: 'chair-1', slotId: 'chair' },
          { resultId: 'lamp-1', slotId: 'light' },
        ],
      },
    ],
  })

  assert.equal(metrics.missionSlotCoverage, 2 / 3)
  assert.equal(metrics.completeBundleRate, 0.5)
})

test('alternatives measure coverage without requiring a bundle', () => {
  const metrics = evaluateSearchRun(
    {
      id: 'comparison',
      query: 'ps5 xbox',
      slices: ['mission'],
      expectedIntent: 'mission',
      relevanceRules: [{ label: 'exact', anyPhrases: ['ps5', 'xbox'] }],
      idealRelevance: { exact: 2 },
      mission: {
        composition: 'alternatives',
        requiredSlots: [
          { id: 'ps5', anyPhrases: ['ps5'] },
          { id: 'xbox', anyPhrases: ['xbox'] },
        ],
      },
    },
    {
      caseId: 'comparison',
      predictedIntent: 'mission',
      results: [
        { resultId: 'ps5', title: 'PS5 Console', source: 'A' },
        { resultId: 'xbox', title: 'Xbox Console', source: 'B' },
      ],
    },
  )

  assert.equal(metrics.missionSlotCoverage, 1)
  assert.equal(metrics.completeBundleRate, null)
  assert.ok(metrics.ndcgAt10 <= 1)
})

test('aggregates slices and measures repeated-run top-10 stability', () => {
  const benchmark: SearchBenchmark = {
    version: 1,
    frozenAt: '2026-08-13',
    description: 'test',
    cases: [productCase],
  }
  const runs: SearchEvaluationRun[] = [
    {
      caseId: productCase.id,
      runId: 'a',
      predictedIntent: 'product',
      results: [
        { resultId: '1', entityId: 'a', title: 'Wireless Headphones', source: 'A' },
        { resultId: '2', entityId: 'b', title: 'Bluetooth Headphones', source: 'B' },
      ],
    },
    {
      caseId: productCase.id,
      runId: 'b',
      predictedIntent: 'mission',
      results: [
        { resultId: '2', entityId: 'b', title: 'Bluetooth Headphones', source: 'B' },
        { resultId: '3', entityId: 'c', title: 'Headphone Case', source: 'C' },
      ],
    },
  ]
  const report = evaluateSearchBenchmark(benchmark, runs)

  assert.equal(report.summary.intentAccuracy, 0.5)
  assert.equal(report.summary.repeatabilityAt10, 1 / 3)
  assert.equal(report.bySlice.product.runs, 2)
  assert.deepEqual(report.missingCaseIds, [])
})

test('the frozen benchmark is valid and covers known regressions and quality slices', async () => {
  const raw = await readFile(
    path.join(process.cwd(), 'benchmarks/search-quality.v1.json'),
    'utf8',
  )
  const benchmark: unknown = JSON.parse(raw)
  validateSearchBenchmark(benchmark)

  assert.ok(benchmark.cases.length >= 20)
  const ids = new Set(benchmark.cases.map((entry) => entry.id))
  assert.ok(ids.has('regression-ps5-xbox'))
  assert.ok(ids.has('regression-terse-product-list'))
  assert.ok(ids.has('regression-home-office-package'))
  assert.ok(ids.has('regression-leather-boots-minimum'))

  const slices = new Set(benchmark.cases.flatMap((entry) => entry.slices))
  for (const slice of [
    'exact-model',
    'compatibility',
    'maximum-price',
    'minimum-price',
    'typo',
    'diversity',
    'source-resilience',
    'mission',
  ]) {
    assert.ok(slices.has(slice), `missing benchmark slice ${slice}`)
  }
})
