import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalProductKey,
  rankSearchCandidates,
  type SearchRankingCandidate,
} from './search-ranking'

function candidate(
  id: string,
  title: string,
  source: string,
  score: number,
  extra: Partial<SearchRankingCandidate> = {},
): SearchRankingCandidate {
  return {
    id,
    title,
    source,
    channels: { lexical: { rank: Math.max(1, Math.round((1 - score) * 100)) } },
    semanticScore: score,
    relevanceScore: score,
    ...extra,
  }
}

test('weighted RRF rewards evidence from multiple retrieval channels and explains it', () => {
  const result = rankSearchCandidates(
    [
      candidate('one-channel', 'Mesh Office Chair', 'amazon', 0.7, {
        channels: { semantic: 1 },
      }),
      candidate('fused', 'Ergonomic Office Chair', 'ebay', 0.7, {
        channels: { semantic: 2, lexical: 2, retailer: 2 },
      }),
    ],
    {
      query: 'office chair',
      maxResults: 2,
      diversityLambda: 1,
      channelWeights: { semantic: 1, lexical: 1, retailer: 2 },
    },
  )

  assert.equal(result.ranked[0].candidate.id, 'fused')
  assert.deepEqual(
    Object.keys(result.ranked[0].score.rrfContributions).sort(),
    ['lexical', 'retailer', 'semantic'],
  )
  assert.ok(result.ranked[0].score.baseRelevance > result.ranked[1].score.baseRelevance)
})

test('canonical identity collapses the same model across retailers without merging nearby models', () => {
  const offers = [
    candidate('amazon-m3', 'Apple 2024 MacBook Air 13 M3 256GB', 'amazon', 0.94, {
      brand: 'Apple',
      model: 'MBA-M3-13-256',
      priceMinor: 99_900,
    }),
    candidate('bestbuy-m3', 'MacBook Air 13-inch M3 256 GB', 'bestbuy', 0.92, {
      brand: 'Apple',
      model: 'MBA-M3-13-256',
      priceMinor: 94_900,
    }),
    candidate('amazon-m2', 'Apple MacBook Air 13 M2 256GB', 'amazon', 0.9, {
      brand: 'Apple',
      model: 'MBA-M2-13-256',
    }),
  ]
  const result = rankSearchCandidates(offers, {
    query: 'macbook air',
    maxResults: 5,
  })

  assert.equal(result.ranked.length, 2)
  assert.equal(result.droppedAsDuplicates, 1)
  assert.equal(result.ranked[0].offers.length, 2)
  assert.deepEqual(new Set(result.ranked[0].sourceKeys), new Set(['amazon', 'bestbuy']))
  assert.notEqual(canonicalProductKey(offers[0]), canonicalProductKey(offers[2]))
})

test('source caps stop one retailer crowding out equally relevant alternatives', () => {
  const result = rankSearchCandidates(
    [
      candidate('a1', 'Apex Mesh Chair', 'amazon', 0.98, { model: 'a1' }),
      candidate('a2', 'Aero Mesh Chair', 'amazon', 0.97, { model: 'a2' }),
      candidate('a3', 'Atlas Mesh Chair', 'amazon', 0.96, { model: 'a3' }),
      candidate('a4', 'Arco Mesh Chair', 'amazon', 0.95, { model: 'a4' }),
      candidate('e1', 'Ergo Executive Chair', 'ebay', 0.92, { model: 'e1' }),
      candidate('w1', 'WorkPro Task Chair', 'walmart', 0.9, { model: 'w1' }),
    ],
    {
      query: 'office chair',
      maxResults: 4,
      maxPerSource: 2,
      diversityLambda: 1,
    },
  )

  const sources = result.ranked.map(({ candidate: item }) => item.source)
  assert.equal(sources.filter((source) => source === 'amazon').length, 2)
  assert.ok(sources.includes('ebay'))
  assert.ok(sources.includes('walmart'))
})

test('broad queries diversify styles while exact queries preserve the closest models', () => {
  const chairs = [
    candidate('mesh-a', 'Acme Mesh Office Chair A100', 'amazon', 0.96, {
      brand: 'Acme',
      model: 'A100',
      aspects: ['mesh', 'ergonomic'],
      embedding: [1, 0],
    }),
    candidate('mesh-b', 'Acme Mesh Office Chair A110', 'ebay', 0.93, {
      brand: 'Acme',
      model: 'A110',
      aspects: ['mesh', 'ergonomic'],
      embedding: [0.999, 0.001],
    }),
    candidate('leather', 'Northstar Leather Executive Chair L8', 'walmart', 0.74, {
      brand: 'Northstar',
      model: 'L8',
      aspects: ['leather', 'executive'],
      embedding: [0, 1],
    }),
  ]

  const broad = rankSearchCandidates(chairs, {
    query: 'office chair',
    querySpecificity: 0,
    maxResults: 3,
  })
  const exact = rankSearchCandidates(chairs, {
    query: 'Acme A110 office chair',
    querySpecificity: 1,
    maxResults: 3,
  })

  assert.equal(broad.ranked[0].candidate.id, 'mesh-a')
  assert.equal(broad.ranked[1].candidate.id, 'leather')
  assert.equal(exact.ranked[0].candidate.id, 'mesh-a')
  assert.equal(exact.ranked[1].candidate.id, 'mesh-b')
  assert.ok(broad.diversityLambda < exact.diversityLambda)
  assert.ok(broad.ranked[1].score.newlyCoveredAspects.includes('facet:leather'))
})

test('weak candidates cannot jump the relevance gate just because they are different', () => {
  const result = rankSearchCandidates(
    [
      candidate('relevant', 'Sony WH-1000XM5 Headphones', 'amazon', 0.95, {
        embedding: [1, 0],
      }),
      candidate('weak', 'Leather Hiking Boots', 'ebay', 0.2, {
        aspects: ['outdoor'],
        embedding: [0, 1],
      }),
      candidate('relevant-two', 'Bose QuietComfort Headphones', 'bestbuy', 0.82, {
        embedding: [0.9, 0.1],
      }),
    ],
    { query: 'headphones', querySpecificity: 0, maxResults: 2 },
  )

  assert.deepEqual(
    result.ranked.map(({ candidate: item }) => item.id),
    ['relevant', 'relevant-two'],
  )
})
