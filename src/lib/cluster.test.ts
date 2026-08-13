import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractIdentityTokens, identityCompatible } from './cluster'

describe('conservative product identity', () => {
  it('keeps exact model identifiers together across noisy offer titles', () => {
    assert.equal(
      identityCompatible(
        'Sony WH-1000XM5 Wireless Headphones - Black',
        'Sony WH1000XM5 noise cancelling headphones',
      ),
      true,
    )
  })

  it('does not merge nearby models from the same product family', () => {
    assert.equal(identityCompatible('Blundstone 585 Chelsea Boots', 'Blundstone 550 Boots'), false)
  })

  it('allows model-less near-identical titles but rejects category similarity', () => {
    assert.equal(
      identityCompatible(
        'Classic waterproof leather Chelsea boot',
        'Classic Leather Chelsea Boots - Waterproof',
      ),
      true,
    )
    assert.equal(identityCompatible('Leather Chelsea boots', 'Leather work boots'), false)
  })

  it('extracts useful mixed and numeric model identifiers', () => {
    assert.ok(extractIdentityTokens('Blundstone 585 Classic boots').includes('585'))
    assert.ok(extractIdentityTokens('Sony WH-1000XM5 headphones').includes('1000xm5'))
    assert.ok(!extractIdentityTokens('Laptop with 512GB SSD').includes('512gb'))
  })
})
