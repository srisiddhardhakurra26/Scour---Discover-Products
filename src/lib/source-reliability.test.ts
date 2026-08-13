import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  recordSourceFailure,
  recordSourceSuccess,
  resetSourceReliability,
  sourceCanAttempt,
  sourceReliabilitySnapshot,
} from './source-reliability'

describe('source circuit breaker', () => {
  afterEach(resetSourceReliability)

  it('opens after repeated failures and recovers on success', () => {
    recordSourceFailure('shop', 100, 1_000)
    recordSourceFailure('shop', 100, 1_000)
    assert.equal(sourceCanAttempt('shop', 1_001), true)
    recordSourceFailure('shop', 100, 1_000)
    assert.equal(sourceCanAttempt('shop', 1_001), false)
    assert.equal(sourceCanAttempt('shop', 1_000 + 5 * 60 * 1000), true)
    recordSourceSuccess('shop', 50)
    assert.equal(sourceReliabilitySnapshot('shop').consecutiveFailures, 0)
  })
})
