import assert from 'node:assert/strict'
import test from 'node:test'
import { envFlag, envMillis } from './env'

test('envFlag does not treat "0" or "false" as enabled', () => {
  assert.equal(envFlag('1'), true)
  assert.equal(envFlag('true'), true)
  assert.equal(envFlag('0'), false)
  assert.equal(envFlag('false'), false)
})

test('envMillis rejects invalid or unsafe intervals', () => {
  assert.equal(envMillis('60000', 1000, 60_000, 120_000), 60_000)
  assert.equal(envMillis('-1', 1000, 60_000, 120_000), 1000)
})
