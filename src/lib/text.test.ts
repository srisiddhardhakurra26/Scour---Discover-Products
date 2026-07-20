import assert from 'node:assert/strict'
import test from 'node:test'
import { hasTokenCoverage, hasTokenOverlap, meaningfulTokens } from './text'

test('meaningfulTokens removes punctuation and connective words', () => {
  assert.deepEqual(meaningfulTokens('Running shoes, for men!'), ['running', 'shoes', 'men'])
})

test('token overlap does not require connective words in listing titles', () => {
  assert.equal(hasTokenOverlap('running shoes for men', "Men's Running Shoes"), true)
})

test('token overlap ignores explicit price-filter language', () => {
  assert.equal(hasTokenOverlap('wireless earbuds under $100', 'Wireless Earbuds'), true)
})

test('price words remain meaningful when they are part of the product name', () => {
  assert.deepEqual(meaningfulTokens('over ear headphones'), ['over', 'ear', 'headphones'])
  assert.deepEqual(meaningfulTokens('under armour hoodie'), ['under', 'armour', 'hoodie'])
  assert.deepEqual(meaningfulTokens('iPhone Pro Max 256GB'), ['iphone', 'pro', 'max', '256gb'])
})

test('token coverage rejects a merely related catalog item', () => {
  assert.equal(hasTokenCoverage('manual coffee grinder', ['Power Surge Coffee']), false)
  assert.equal(
    hasTokenCoverage('manual coffee grinder', ['Stainless Manual Grinder', 'for coffee beans']),
    true,
  )
})
