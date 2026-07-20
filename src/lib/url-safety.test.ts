import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isSafeRemoteUrl,
  isStorefrontUrl,
  normalizeStorefrontDomain,
  resolveSafeHttpUrl,
} from './url-safety'

test('normalizes public storefront domains', () => {
  assert.equal(normalizeStorefrontDomain('https://www.example.com/products'), 'www.example.com')
  assert.equal(normalizeStorefrontDomain('shop.example.com'), 'shop.example.com')
})

test('rejects local, private, and credentialed storefronts', () => {
  assert.equal(normalizeStorefrontDomain('localhost:3000'), null)
  assert.equal(normalizeStorefrontDomain('http://127.0.0.1'), null)
  assert.equal(normalizeStorefrontDomain('http://192.168.1.4'), null)
  assert.equal(normalizeStorefrontDomain('https://user:pass@example.com'), null)
  assert.equal(isSafeRemoteUrl('http://[::1]/secret'), false)
  assert.equal(isSafeRemoteUrl('http://[::ffff:7f00:1]/secret'), false)
})

test('keeps generated search URLs on the configured storefront', () => {
  assert.equal(
    isStorefrontUrl('https://www.example.com/search?q={query}', 'example.com', {
      requireQueryPlaceholder: true,
    }),
    true,
  )
  assert.equal(
    isStorefrontUrl('https://example.evil/search?q={query}', 'example.com', {
      requireQueryPlaceholder: true,
    }),
    false,
  )
  assert.equal(
    isStorefrontUrl('http://127.0.0.1/search?q={query}', 'example.com', {
      requireQueryPlaceholder: true,
    }),
    false,
  )
})

test('resolves safe relative and protocol-relative URLs', () => {
  assert.equal(
    resolveSafeHttpUrl('/product/1', 'https://example.com/search'),
    'https://example.com/product/1',
  )
  assert.equal(
    resolveSafeHttpUrl('//cdn.example.com/image.jpg', 'https://example.com/search'),
    'https://cdn.example.com/image.jpg',
  )
  assert.equal(isSafeRemoteUrl('file:///etc/passwd'), false)
})
