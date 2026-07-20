import type { Retailer } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { Adapter } from './types'
import { createShopifyAdapter } from './shopify'
import { createWooCommerceAdapter } from './woocommerce'
import { createMockEbayAdapter } from './mock-ebay'
import { createMockAmazonAdapter } from './mock-amazon'
import { createSlickdealsAdapter } from './slickdeals'
import { createRedditAdapter } from './reddit'
import { createEbayAdapter } from './ebay'
import { createEtsyAdapter } from './etsy'
import { createBestBuyAdapter } from './bestbuy'
import { createAmazonAdapter } from './amazon'
import { createGenericHtmlAdapter } from './generic-html'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'
import { isStorefrontUrl, normalizeStorefrontDomain } from '@/lib/url-safety'

export const ADAPTER_TIMEOUT_MS = 4000

function validGenericConfig(config: GenericHtmlConfig, domain: string): boolean {
  if (
    config.searchUrlTemplate.length > 2_000 ||
    !isStorefrontUrl(config.searchUrlTemplate, domain, {
      requireQueryPlaceholder: true,
    }) ||
    (config.urlPrefix !== undefined && !isStorefrontUrl(config.urlPrefix, domain))
  ) {
    return false
  }
  if (config.extraction === 'jsonld') return true
  return [
    config.productSelector,
    config.titleSelector,
    config.priceSelector,
    config.imageSelector,
    config.urlSelector,
  ].every((selector) => typeof selector === 'string' && selector.length > 0 && selector.length <= 500)
}

function buildAdapter(r: Retailer): Adapter | null {
  const label = r.label ?? r.identifier

  if (r.type === 'shopify') {
    if (normalizeStorefrontDomain(r.identifier) !== r.identifier.toLowerCase()) return null
    return createShopifyAdapter({ id: r.id, label, domain: r.identifier })
  }
  if (r.type === 'woocommerce') {
    if (normalizeStorefrontDomain(r.identifier) !== r.identifier.toLowerCase()) return null
    return createWooCommerceAdapter({ id: r.id, label, domain: r.identifier })
  }
  if (r.type === 'reddit') {
    return createRedditAdapter(r.id, label, r.identifier)
  }
  if (r.type === 'rss' && r.identifier === 'slickdeals.net') {
    return createSlickdealsAdapter(r.id, label)
  }
  if (r.type === 'ebay' && r.identifier === 'ebay') {
    return createEbayAdapter(r.id, label)
  }
  if (r.type === 'etsy' && r.identifier === 'etsy') {
    return createEtsyAdapter(r.id, label)
  }
  if (r.type === 'bestbuy' && r.identifier === 'bestbuy') {
    return createBestBuyAdapter(r.id, label)
  }
  if (r.type === 'amazon' && r.identifier === 'amazon') {
    return createAmazonAdapter(r.id, label)
  }
  if (r.type === 'generic-html' && r.config) {
    try {
      const config = JSON.parse(r.config) as GenericHtmlConfig
      if (!validGenericConfig(config, r.identifier)) return null
      return createGenericHtmlAdapter(r.id, label, r.identifier, config)
    } catch {
      return null
    }
  }
  if (r.type === 'mock' && r.identifier === 'mock-ebay') {
    return createMockEbayAdapter(r.id, label)
  }
  if (r.type === 'mock' && r.identifier === 'mock-amazon') {
    return createMockAmazonAdapter(r.id, label)
  }
  return null
}

export async function getAdapters(): Promise<Adapter[]> {
  const retailers = await prisma.retailer.findMany({
    where: { enabled: true },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  })
  return retailers.flatMap((r) => {
    const a = buildAdapter(r)
    return a ? [a] : []
  })
}

// Build a single adapter by retailer id regardless of its enabled flag. Used by
// the repair console to test/diagnose a source on demand without going through
// the full enabled fan-out.
export async function getAdapterById(id: string): Promise<Adapter | null> {
  const r = await prisma.retailer.findUnique({ where: { id } })
  return r ? buildAdapter(r) : null
}
