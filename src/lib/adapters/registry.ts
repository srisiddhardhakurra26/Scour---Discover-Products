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

export const ADAPTER_TIMEOUT_MS = 4000

function buildAdapter(r: Retailer): Adapter | null {
  const label = r.label ?? r.identifier

  if (r.type === 'shopify') {
    return createShopifyAdapter({ id: r.id, label, domain: r.identifier })
  }
  if (r.type === 'woocommerce') {
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
