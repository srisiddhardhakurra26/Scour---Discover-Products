import assert from 'node:assert/strict'
import test from 'node:test'
import { hammingDistance, hashesMatch, isUsefulHash } from './phash'

test('invalid and flat-image hashes never match', () => {
  assert.equal(hammingDistance('invalid', '0000000000000000'), 65)
  assert.equal(isUsefulHash('0000000000000000'), false)
  assert.equal(isUsefulHash('ffffffffffffffff'), false)
  assert.equal(hashesMatch('0000000000000000', '0000000000000000'), false)
})

test('nearby useful perceptual hashes still match', () => {
  assert.equal(hashesMatch('0f0f0f0f0f0f0f0f', '0f0f0f0f0f0f0f07'), true)
})
