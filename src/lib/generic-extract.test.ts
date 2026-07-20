import assert from 'node:assert/strict'
import test from 'node:test'
import { extractListings, parsePriceMinor } from './adapters/generic-extract'
import type { GenericHtmlConfig } from './llm/source-onboarder'

test('parses US and European storefront prices', () => {
  assert.equal(parsePriceMinor('$1,299.99'), 129_999)
  assert.equal(parsePriceMinor('€1.299,99'), 129_999)
  assert.equal(parsePriceMinor('1 299,99 €'), 129_999)
  assert.equal(parsePriceMinor('From $29'), 2_900)
})

test('generic extraction resolves safe links and drops unsafe product URLs', () => {
  const config: GenericHtmlConfig = {
    searchUrlTemplate: 'https://example.com/search?q={query}',
    productSelector: '.card',
    titleSelector: '.title',
    priceSelector: '.price',
    imageSelector: 'img',
    urlSelector: 'a',
  }
  const listings = extractListings(
    `<div class="card"><span class="title">Safe Product</span><span class="price">$29.99</span><a href="/p/1"></a><img src="//cdn.example.com/1.jpg"></div>
     <div class="card"><span class="title">Unsafe Product</span><span class="price">$9.99</span><a href="javascript:alert(1)"></a></div>`,
    config,
    'example.com',
    'Example',
  )

  assert.equal(listings.length, 1)
  assert.equal(listings[0].url, 'https://example.com/p/1')
  assert.equal(listings[0].imageUrl, 'https://cdn.example.com/1.jpg')
})
