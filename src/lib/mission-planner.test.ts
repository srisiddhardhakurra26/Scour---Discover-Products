import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enforceMissionPriceBounds,
  fallbackMissionPlan,
  type MissionPlan,
} from './llm/mission-planner'

function mistakenPlan(): MissionPlan {
  return {
    summary: 'Leather boots over $150',
    composition: 'alternatives',
    budgetMaxMinor: 15000,
    criteria: ['quality'],
    queries: [
      {
        q: 'leather Chelsea boots',
        maxPriceMinor: 15000,
        reason: 'style option',
      },
    ],
  }
}

test('mission price floors override a planner-invented ceiling', () => {
  const plan = enforceMissionPriceBounds(
    mistakenPlan(),
    'expensive leather boots over $150',
  )
  assert.equal(plan.budgetMinMinor, 15000)
  assert.equal(plan.budgetMaxMinor, undefined)
  assert.equal(plan.queries[0].minPriceMinor, 15000)
  assert.equal(plan.queries[0].maxPriceMinor, undefined)
})

test('mission price ceilings cannot become floors', () => {
  const source = mistakenPlan()
  source.budgetMinMinor = 15000
  source.queries[0].minPriceMinor = 15000
  const plan = enforceMissionPriceBounds(source, 'leather boots under $200')
  assert.equal(plan.budgetMinMinor, undefined)
  assert.equal(plan.budgetMaxMinor, 20000)
  assert.equal(plan.queries[0].minPriceMinor, undefined)
  assert.equal(plan.queries[0].maxPriceMinor, 20000)
})

test('home-office fallback creates distinct required categories', () => {
  const plan = fallbackMissionPlan('Furnish a home office under $500')
  assert.equal(plan.composition, 'bundle')
  assert.deepEqual(
    plan.queries.map((query) => query.q),
    ['office desk', 'ergonomic office chair', 'task lamp'],
  )
})

test('gift fallback creates alternatives instead of a package', () => {
  const plan = fallbackMissionPlan('Find a birthday gift for a cyclist under $80')
  assert.equal(plan.composition, 'alternatives')
  assert.equal(plan.queries.length, 3)
  assert.match(plan.queries[0].q, /bike/i)
})

test('explicit product lists become required bundle slots', () => {
  const plan = fallbackMissionPlan('monitor chair backpack')
  assert.equal(plan.composition, 'bundle')
  assert.deepEqual(
    plan.queries.map((query) => query.q),
    ['monitor', 'chair', 'backpack'],
  )
})

test('competing named products become comparison alternatives', () => {
  const plan = fallbackMissionPlan('ps5 xbox')
  assert.equal(plan.composition, 'alternatives')
  assert.deepEqual(
    plan.queries.map((query) => query.q),
    ['PlayStation 5 console', 'Xbox Series X console'],
  )
})
