import assert from 'node:assert/strict'
import test from 'node:test'
import type { NormalizedListing } from './adapters/types'
import {
  buildSearchSpec,
  classifyProductRole,
  filterEligibleListings,
} from './search-spec'

test('conversational uncertainty is not parsed as an exclusion', () => {
  const spec = buildSearchSpec('leather boots over $150, not sure what style suits me')
  assert.deepEqual(spec.mustNot, [])
  assert.equal(spec.minPriceMinor, 15_000)
})

function listing(title: string, priceMinor = 49_900, detailsText?: string): NormalizedListing {
  return {
    externalId: title,
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    priceMinor,
    currency: 'USD',
    detailsText,
  }
}

test('builds one deterministic spec for a PS5 console search', () => {
  const spec = buildSearchSpec('PS5 console')
  assert.equal(spec.kind, 'product')
  assert.equal(spec.productType, 'game console')
  assert.equal(spec.brand, 'Sony')
  assert.equal(spec.model, 'PlayStation 5')
})

test('separates exact consoles from substitutes, games, and controllers', () => {
  const spec = buildSearchSpec('PS5 console')
  assert.equal(classifyProductRole(spec, listing('Sony PlayStation 5 Slim Digital Edition Console')).role, 'exact')
  const competingConsole = classifyProductRole(spec, listing('Microsoft Xbox Series X Console 1TB'))
  assert.equal(competingConsole.role, 'substitute')
  assert.equal(competingConsole.eligible, false)

  const game = classifyProductRole(spec, listing('Elden Ring Nightreign Video Game for PS5'))
  assert.equal(game.role, 'complement')
  assert.equal(game.eligible, false)

  const platformOnlyGame = classifyProductRole(spec, listing('Elden Ring Nightreign (PS5)'))
  assert.equal(platformOnlyGame.role, 'complement')
  assert.equal(platformOnlyGame.eligible, false)

  const controller = classifyProductRole(spec, listing('Sony DualSense Wireless Controller for PS5'))
  assert.equal(controller.role, 'complement')
  assert.equal(controller.eligible, false)

  const stand = classifyProductRole(spec, listing('Vertical Console Stand and Cooling Fan for PS5'))
  assert.equal(stand.role, 'complement')
  assert.equal(stand.eligible, false)

  const discDrive = classifyProductRole(
    spec,
    listing('PlayStation Disc Drive For PS5 Digital Edition Consoles (slim)'),
  )
  assert.equal(discDrive.role, 'complement')
  assert.equal(discDrive.eligible, false)

  const xboxGame = classifyProductRole(
    buildSearchSpec('Xbox Series X console'),
    listing('007 First Light - Specialist Edition - Xbox Series X'),
  )
  assert.equal(xboxGame.role, 'complement')
  assert.equal(xboxGame.eligible, false)

  const xboxBundle = classifyProductRole(
    buildSearchSpec('Xbox Series X console'),
    listing('Xbox Series X - All Digital Gaming Console - Includes Wireless Controller'),
  )
  assert.equal(xboxBundle.role, 'exact')
  assert.equal(xboxBundle.eligible, true)

  const controllerForXbox = classifyProductRole(
    buildSearchSpec('Xbox Series X console'),
    listing('Wireless Controller for Xbox Series X Console'),
  )
  assert.equal(controllerForXbox.role, 'complement')
  assert.equal(controllerForXbox.eligible, false)

  const filtered = filterEligibleListings(spec, [
    listing('Sony PlayStation 5 Slim Digital Edition Console'),
    listing('Elden Ring Nightreign Video Game for PS5'),
    listing('Sony DualSense Wireless Controller for PS5'),
  ])
  assert.deepEqual(filtered.map((item) => item.title), ['Sony PlayStation 5 Slim Digital Edition Console'])
})

test('parses terse product lists separately from one product request', () => {
  const list = buildSearchSpec('ps5 xbox')
  assert.equal(list.kind, 'list')
  assert.deepEqual(list.targets.map((target) => target.model), ['PlayStation 5', 'Xbox Series X'])

  const single = buildSearchSpec('PS5 controller')
  assert.equal(single.kind, 'product')
  assert.equal(single.productType, 'controller')
})

test('makes a demanded material a hard requirement and rejects faux evidence', () => {
  const spec = buildSearchSpec('Blundstone leather boots')
  assert.equal(spec.productType, 'boots')
  assert.equal(spec.brand, 'Blundstone')
  assert.deepEqual(spec.must, ['leather'])
  assert.equal(
    classifyProductRole(spec, listing('Blundstone 585 Classic Leather Chelsea Boots')).role,
    'exact',
  )
  assert.equal(
    classifyProductRole(spec, listing('Blundstone Vegan Chelsea Boots', 20_000, 'synthetic leather alternative')).role,
    'irrelevant',
  )
})

test('keeps requested product subtypes hard and rejects accessory-only titles', () => {
  const spec = buildSearchSpec('ergonomic office chair')
  assert.ok(spec.must.includes('ergonomic'))
  assert.ok(spec.must.includes('office'))

  const officeChair = classifyProductRole(
    spec,
    listing('Executive Ergonomic Desk Chair with Lumbar Support'),
  )
  const accentChair = classifyProductRole(
    spec,
    listing('Gianna Fabric Accent Chair with Armrests'),
  )
  const carryBag = classifyProductRole(
    buildSearchSpec('chair'),
    listing('Camp Chair Carry Bag for Standard Folding Chairs'),
  )

  assert.equal(officeChair.eligible, true)
  assert.equal(accentChair.eligible, false)
  assert.equal(carryBag.role, 'complement')
  assert.equal(carryBag.eligible, false)

  const careKit = classifyProductRole(
    buildSearchSpec('leather boots'),
    listing('Shoe Care Kit for Leather Boots with Renovating Cream and Waterproof Spray'),
  )
  assert.equal(careKit.role, 'complement')
  assert.equal(careKit.eligible, false)
})

test('extracts alphanumeric and brand-number model names', () => {
  const sony = buildSearchSpec('Sony WH-1000XM5 headphones')
  assert.equal(sony.brand, 'Sony')
  assert.equal(sony.model, 'WH-1000XM5')
  assert.equal(
    classifyProductRole(sony, listing('Sony WH-1000XM5 Wireless Noise Cancelling Headphones')).role,
    'exact',
  )
  assert.equal(
    classifyProductRole(sony, listing('Sony WH-1000XM4 Wireless Headphones')).role,
    'substitute',
  )

  const blundstone = buildSearchSpec('Blundstone 585 leather boots')
  assert.equal(blundstone.model, '585')
})

test('recognizes exact generations, compound types, and safe typo corrections', () => {
  const sony = buildSearchSpec('Sony WH-1000XM5')
  assert.equal(sony.productType, 'headphones')
  assert.equal(sony.brand, 'Sony')
  assert.equal(sony.model, 'WH-1000XM5')

  const airpods = buildSearchSpec('AirPods Pro 2nd generation USB-C')
  assert.ok(airpods.must.includes('2nd generation'))
  assert.ok(airpods.must.includes('usb-c'))
  assert.equal(
    classifyProductRole(
      airpods,
      listing('Apple AirPods Pro 2nd Generation with USB-C Charging Case'),
    ).role,
    'exact',
  )
  assert.equal(
    classifyProductRole(
      airpods,
      listing('Apple AirPods Pro 3 Wireless Earbuds with USB-C Charging'),
    ).eligible,
    false,
  )
  assert.equal(
    classifyProductRole(
      airpods,
      listing('AirPods Pro (2nd Generation) USB-C MagSafe Charging Case Replacement'),
    ).eligible,
    false,
  )
  assert.equal(
    classifyProductRole(
      airpods,
      listing('for AirPods Pro 2 Case, Compatible with 2nd Generation USB-C'),
    ).eligible,
    false,
  )

  const dock = buildSearchSpec('USB-C dock for M2 MacBook Air dual monitors')
  assert.equal(dock.productType, 'docking station')
  assert.deepEqual(dock.compatibility, ['MacBook'])
  assert.ok(dock.must.includes('dual monitor'))

  const watch = buildSearchSpec('GPS running watch under $250')
  assert.equal(watch.productType, 'watch')
  assert.ok(watch.must.includes('gps'))
  assert.ok(watch.must.includes('running'))

  const typo = buildSearchSpec('wireles noise canceling headphnes')
  assert.equal(typo.productType, 'headphones')
  assert.match(typo.refinedQuery, /wireless noise canceling headphones/i)
  assert.ok(typo.must.includes('noise cancelling'))
})

test('treats vegan leather as one material requirement', () => {
  const spec = buildSearchSpec('vegan leather tote bag under $80')
  assert.equal(spec.productType, 'tote bag')
  assert.ok(spec.must.includes('vegan leather'))
  assert.ok(!spec.must.includes('leather'))
  assert.equal(
    classifyProductRole(
      spec,
      listing('Large PU Leather Vegan Material Tote Bag', 1599),
    ).role,
    'exact',
  )
  assert.equal(
    classifyProductRole(spec, listing('Genuine Leather Chelsea Boots', 6500)).eligible,
    false,
  )
})

test('parses and enforces price direction deterministically', () => {
  const spec = buildSearchSpec('leather boots between $150 and $300')
  assert.equal(spec.minPriceMinor, 15_000)
  assert.equal(spec.maxPriceMinor, 30_000)
  assert.equal(classifyProductRole(spec, listing('Leather Chelsea Boots', 14_999)).eligible, false)
  assert.equal(classifyProductRole(spec, listing('Leather Chelsea Boots', 20_000)).eligible, true)
  assert.equal(classifyProductRole(spec, listing('Leather Chelsea Boots', 30_001)).eligible, false)
})

test('enforces exclusions, compatibility, and condition', () => {
  const shoes = buildSearchSpec('running shoes not red under $120')
  assert.deepEqual(shoes.mustNot, ['red'])
  assert.equal(classifyProductRole(shoes, listing('Red Running Shoes', 8_000)).eligible, false)
  assert.equal(classifyProductRole(shoes, listing('Blue Running Shoes', 8_000)).eligible, true)

  const controller = buildSearchSpec('wireless controller for PS5')
  assert.deepEqual(controller.compatibility, ['PlayStation 5'])
  assert.equal(controller.model, undefined)
  assert.equal(classifyProductRole(controller, listing('DualSense Wireless Controller for PS5')).role, 'exact')
  assert.equal(classifyProductRole(controller, listing('Wireless Controller for Xbox Series X')).role, 'irrelevant')

  const condition = buildSearchSpec('refurbished PS5 console')
  assert.equal(condition.condition, 'refurbished')
  assert.equal(classifyProductRole(condition, listing('Renewed Sony PlayStation 5 Console')).eligible, true)
  assert.equal(classifyProductRole(condition, listing('New Sony PlayStation 5 Console')).eligible, false)
})
