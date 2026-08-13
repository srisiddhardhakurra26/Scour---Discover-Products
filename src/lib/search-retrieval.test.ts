import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSearchSpec } from './search-spec'
import {
  bm25RankedIds,
  buildQueryVariants,
  lexicalMatchScore,
} from './search-retrieval'

test('controlled variants retain literal intent and do not expand exact models', () => {
  const broad = buildQueryVariants(buildSearchSpec('leather boots'))
  assert.equal(broad[0], 'leather boots')
  assert.ok(broad.some((variant) => variant.includes('chelsea boots')))

  const exact = buildQueryVariants(buildSearchSpec('Sony WH-1000XM5'))
  assert.ok(exact.length <= 2)
  assert.ok(exact.every((variant) => variant.includes('1000xm5')))
})

test('lexical scoring protects exact models across punctuation', () => {
  assert.ok(
    lexicalMatchScore('sony wh 1000xm5', 'Sony WH-1000XM5 Wireless Headphones') > 0.9,
  )
  assert.ok(lexicalMatchScore('game console', 'Elden Ring Nightreign PS5 Game') < 0.5)
})

test('BM25 rewards rare exact terms and resists long keyword-stuffed documents', () => {
  const ranks = bm25RankedIds('sony wh 1000xm5', [
    { id: 'exact', text: 'Sony WH-1000XM5 wireless headphones' },
    {
      id: 'stuffed',
      text: 'Sony headphones audio wireless sale case cable replacement compatible accessories '.repeat(12),
    },
    { id: 'other', text: 'Bose QuietComfort wireless headphones' },
  ])
  assert.equal(ranks.get('exact'), 1)
  assert.ok((ranks.get('stuffed') ?? Infinity) > 1)
  assert.equal(ranks.has('other'), false)
})
