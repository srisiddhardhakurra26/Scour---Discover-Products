import assert from 'node:assert/strict'
import test from 'node:test'
import { explicitProductList, productListComposition } from './product-list'

test('detects named console alternatives', () => {
  const products = explicitProductList('ps5 xbox')
  assert.deepEqual(products, ['PlayStation 5 console', 'Xbox Series X console'])
  assert.equal(productListComposition(products), 'alternatives')
})

test('does not split console accessories into multiple products', () => {
  assert.deepEqual(explicitProductList('ps5 controller'), [])
  assert.deepEqual(explicitProductList('xbox controller'), [])
  assert.deepEqual(explicitProductList('xbox series x console'), [])
})
