import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMissionBundles,
  matchesConsoleHardware,
  type MissionCandidate,
} from './mission'
import type { MissionPlan } from './llm/mission-planner'

const plan: MissionPlan = {
  summary: 'Home office under $500',
  composition: 'bundle',
  budgetMaxMinor: 50000,
  criteria: ['ergonomic', 'compact'],
  queries: [
    { q: 'office desk', reason: 'work surface' },
    { q: 'office chair', reason: 'seating' },
    { q: 'task lamp', reason: 'lighting' },
  ],
}

function candidate(
  id: string,
  query: string,
  priceMinor: number,
  score: number,
): MissionCandidate {
  return {
    id,
    title: `${query} ${id}`,
    priceMinor,
    currency: 'USD',
    store: 'Test Store',
    storeType: 'test',
    url: `https://example.com/${id}`,
    query,
    score,
  }
}

test('mission bundles include one item per slot and respect total budget', () => {
  const bundles = buildMissionBundles(plan, [
    [candidate('desk-a', 'office desk', 20000, 0.8), candidate('desk-b', 'office desk', 15000, 0.7)],
    [candidate('chair-a', 'office chair', 22000, 0.85), candidate('chair-b', 'office chair', 16000, 0.72)],
    [candidate('lamp-a', 'task lamp', 5000, 0.78), candidate('lamp-b', 'task lamp', 3000, 0.68)],
  ])
  assert.ok(bundles.length >= 2)
  for (const bundle of bundles) {
    assert.equal(bundle.items.length, 3)
    assert.deepEqual(new Set(bundle.items.map((item) => item.query)).size, 3)
    assert.ok(bundle.totalMinor <= 50000)
  }
})

test('mission bundles refuse incomplete slot coverage', () => {
  const bundles = buildMissionBundles(plan, [
    [candidate('desk-a', 'office desk', 20000, 0.8)],
    [],
    [candidate('lamp-a', 'task lamp', 5000, 0.78)],
  ])
  assert.deepEqual(bundles, [])
})

test('console mission slots reject games and accept console hardware', () => {
  assert.equal(
    matchesConsoleHardware('PlayStation 5 console', 'Elden Ring Nightreign (PS5)'),
    false,
  )
  assert.equal(
    matchesConsoleHardware('PlayStation 5 console', 'PlayStation 5 Digital Edition (Slim)'),
    true,
  )
  assert.equal(
    matchesConsoleHardware('Xbox Series X console', 'Halo: Campaign Evolved Standard Edition'),
    false,
  )
  assert.equal(
    matchesConsoleHardware('Xbox Series X console', 'Xbox Series X All-Digital Console 1TB'),
    true,
  )
})
