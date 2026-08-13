import assert from 'node:assert/strict'
import test from 'node:test'
import { privacySafeSearchDiagnostics } from './search-telemetry'

test('telemetry diagnostics never retain query-derived variants', () => {
  const safe = privacySafeSearchDiagnostics({
    variants: ['private literal query', 'private expanded query'],
    liveCandidates: 12,
    sources: [{ id: 'store', failed: false }],
  })

  assert.equal('variants' in safe, false)
  assert.equal(safe.variantCount, 2)
  assert.equal(JSON.stringify(safe).includes('private literal query'), false)
  assert.equal(safe.liveCandidates, 12)
})
