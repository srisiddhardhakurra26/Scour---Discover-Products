import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedListing } from './adapters/types'
import {
  adapterSearchKey,
  cachedListingsForQuery,
  dedupeListings,
} from './result-quality'

function listing(
  externalId: string,
  title: string,
  priceMinor: number,
): NormalizedListing {
  return {
    externalId,
    title,
    url: `https://example.com/${externalId}`,
    priceMinor,
    currency: 'USD',
  }
}

test('dedupeListings keeps one priced copy per external ID', () => {
  const results = dedupeListings([
    listing('same-id', 'Sponsored Ad - Wireless Earbuds', 0),
    listing('same-id', 'Wireless Earbuds', 2999),
    listing('other-id', 'Other Earbuds', 1999),
  ])

  assert.equal(results.length, 2)
  assert.equal(results[0].title, 'Wireless Earbuds')
  assert.equal(results[0].priceMinor, 2999)
})

test('cachedListingsForQuery rejects listings from a previous query', () => {
  const results = cachedListingsForQuery('running shoes', [
    listing('earbuds', 'Wireless Earbuds for Running and Workouts', 1999),
    listing('shoes', 'Adidas Running Shoes', 4999),
  ])

  assert.deepEqual(results.map((item) => item.externalId), ['shoes'])
})

test('adapter search keys reuse equivalent queries without mixing different ones', () => {
  assert.equal(
    adapterSearchKey('amazon', '  Running   Shoes '),
    adapterSearchKey('amazon', 'running shoes'),
  )
  assert.notEqual(
    adapterSearchKey('amazon', 'running shoes'),
    adapterSearchKey('amazon', 'wireless earbuds'),
  )
})

test('dedupeListings drops unsafe or malformed adapter output', () => {
  const unsafe = listing('unsafe', 'Unsafe', 100)
  unsafe.url = 'file:///etc/passwd'
  const negative = listing('negative', 'Negative', -1)

  assert.deepEqual(dedupeListings([unsafe, negative]), [])
})
