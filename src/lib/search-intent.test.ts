import assert from 'node:assert/strict'
import test from 'node:test'
import { fallbackSearchIntent } from './llm/search-intent'

test('intent fallback recognizes multi-category missions', () => {
  assert.equal(fallbackSearchIntent('Furnish a home office under $500').intent, 'mission')
  assert.equal(fallbackSearchIntent('Build a coffee setup under $300').intent, 'mission')
  assert.equal(fallbackSearchIntent('Gift for a cyclist under $75').intent, 'mission')
  assert.equal(fallbackSearchIntent('monitor chair backpack').intent, 'mission')
  assert.equal(fallbackSearchIntent('monitor, chair and backpack').intent, 'mission')
})

test('intent fallback keeps single product requests in normal search', () => {
  assert.equal(
    fallbackSearchIntent('expensive leather boots over $150, not sure what style').intent,
    'product',
  )
  assert.equal(
    fallbackSearchIntent('quiet mechanical keyboard for office under $120').intent,
    'product',
  )
  assert.equal(fallbackSearchIntent('laptop backpack').intent, 'product')
  assert.equal(fallbackSearchIntent('chair mat').intent, 'product')
  assert.equal(fallbackSearchIntent('monitor stand').intent, 'product')
})
