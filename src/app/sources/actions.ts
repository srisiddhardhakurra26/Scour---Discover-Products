'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { onboardSource } from '@/lib/llm/source-onboarder'
import { repairGenericAdapter } from '@/lib/llm/adapter-repair'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'
import { getAdapterById } from '@/lib/adapters/registry'
import { formatPrice } from '@/lib/format'
import { dedupeListings } from '@/lib/result-quality'
import {
  assertSafeRemoteUrl,
  fetchSafeRemote,
  normalizeStorefrontDomain,
} from '@/lib/url-safety'
import { readJsonLimited } from '@/lib/http'

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

function validId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id)
}

type DetectResult =
  | { ok: true; type: 'shopify' | 'woocommerce' }
  | { ok: false; message: string }

async function detectStoreType(domain: string): Promise<DetectResult> {
  const headers = {
    accept: 'application/json',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': REALISTIC_UA,
  }

  let shopifyStatus: number | null = null
  // Try Shopify first
  try {
    const res = await fetchSafeRemote(`https://${domain}/products.json?limit=1`, {
      signal: AbortSignal.timeout(6000),
      headers,
    })
    shopifyStatus = res.status
    if (res.ok) {
      const data = await readJsonLimited<{ products?: unknown }>(res, 1_000_000)
      if (Array.isArray(data.products)) return { ok: true, type: 'shopify' }
    }
  } catch {
    // ignore, try woocommerce
  }

  // Fall back to WooCommerce Store API
  try {
    const res = await fetchSafeRemote(`https://${domain}/wp-json/wc/store/v1/products?per_page=1`, {
      signal: AbortSignal.timeout(6000),
      headers,
    })
    if (res.ok) {
      const data = await readJsonLimited<unknown>(res, 1_000_000)
      if (Array.isArray(data)) return { ok: true, type: 'woocommerce' }
    }
  } catch {
    // ignore
  }

  if (shopifyStatus === 403) {
    return {
      ok: false,
      message: 'Storefront is blocking automated requests (Cloudflare / bot protection).',
    }
  }

  return {
    ok: false,
    message: 'Not a recognized Shopify or WooCommerce storefront.',
  }
}

export async function addStoreRetailer(
  _prev: { error?: string; ok?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const raw = String(formData.get('domain') ?? '')
  const labelRaw = String(formData.get('label') ?? '').trim().slice(0, 80)
  const domain = normalizeStorefrontDomain(raw)
  if (!domain) return { error: 'Enter a valid domain (e.g. allbirds.com).' }

  try {
    await assertSafeRemoteUrl(`https://${domain}/`)
  } catch {
    return { error: 'That domain is unavailable or resolves to a private network.' }
  }

  const detect = await detectStoreType(domain)

  if (detect.ok) {
    const existing = await prisma.retailer.findUnique({
      where: { type_identifier: { type: detect.type, identifier: domain } },
    })
    if (existing) return { error: `${domain} is already added (${detect.type}).` }

    await prisma.retailer.create({
      data: {
        type: detect.type,
        identifier: domain,
        label: labelRaw || domain.replace(/^www\./, ''),
        enabled: true,
      },
    })

    revalidatePath('/sources')
    revalidatePath('/')
    return { ok: true }
  }

  // Fast paths failed → let the onboarder agent inspect the homepage and
  // generate a generic-html config. Slower (one LLM call + one fetch), so
  // the form's "Checking…" state can sit here for a few seconds.
  const onboarded = await onboardSource(domain)
  if (!onboarded.ok) {
    if (onboarded.blocked) {
      return {
        error:
          `${domain} blocks automated access (bot protection), so it can't be added ` +
          `as a scraped source. Stores like this only work via an official API or feed.`,
      }
    }
    return {
      error: `${detect.message} (agent couldn't onboard it either: ${onboarded.message})`,
    }
  }
  const config = onboarded.config

  const existing = await prisma.retailer.findUnique({
    where: { type_identifier: { type: 'generic-html', identifier: domain } },
  })
  if (existing) return { error: `${domain} is already added (generic-html).` }

  await prisma.retailer.create({
    data: {
      type: 'generic-html',
      identifier: domain,
      label: labelRaw || config.brandName || domain.replace(/^www\./, ''),
      enabled: true,
      config: JSON.stringify(config),
    },
  })

  revalidatePath('/sources')
  revalidatePath('/')
  return { ok: true }
}

export async function toggleRetailer(id: string, enabled: boolean) {
  if (!validId(id) || typeof enabled !== 'boolean') throw new Error('Invalid source update.')
  await prisma.retailer.update({ where: { id }, data: { enabled } })
  revalidatePath('/sources')
  revalidatePath('/')
}

export async function removeRetailer(id: string) {
  if (!validId(id)) throw new Error('Invalid source.')
  const retailer = await prisma.retailer.findUnique({ where: { id }, select: { type: true } })
  if (!retailer || !['shopify', 'woocommerce', 'generic-html'].includes(retailer.type)) {
    throw new Error('Only user-added storefronts can be removed.')
  }
  await prisma.retailer.delete({ where: { id } })
  revalidatePath('/sources')
  revalidatePath('/')
}

export type DiagnoseResult = {
  ok: boolean
  count?: number
  samples?: Array<{ title: string; price: string; url: string }>
  elapsedMs?: number
  error?: string
}

// Run a source live against a sample query and report what came back, without
// persisting anything. This is the "test" half of the repair console: it lets
// the user see whether a source is healthy (and how slow it is) before deciding
// to repair. Uses a generous timeout — Playwright-backed sources are slow, and
// this is a manual diagnostic, not the latency-sensitive search path.
export async function diagnoseRetailer(
  id: string,
  sampleQuery: string,
): Promise<DiagnoseResult> {
  if (!validId(id)) return { ok: false, error: 'Invalid source.' }
  const query = sampleQuery.trim().slice(0, 200)
  if (!query) return { ok: false, error: 'Provide a sample search query.' }

  const adapter = await getAdapterById(id)
  if (!adapter) return { ok: false, error: 'Source could not be built (missing or invalid config).' }

  const started = performance.now()
  try {
    const listings = dedupeListings(
      await adapter.search(query, AbortSignal.timeout(20_000)),
    )
    const elapsedMs = Math.round(performance.now() - started)
    return {
      ok: true,
      count: listings.length,
      elapsedMs,
      samples: listings.slice(0, 3).map((l) => ({
        title: l.title,
        price: l.priceMinor > 0 ? formatPrice(l.priceMinor, l.currency) : '—',
        url: l.url,
      })),
    }
  } catch (err) {
    return {
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      error: err instanceof Error ? err.message : 'unknown error',
    }
  }
}

export async function repairRetailer(
  id: string,
  sampleQuery: string,
): Promise<{ ok?: boolean; error?: string }> {
  if (!validId(id)) return { error: 'Invalid source.' }
  const trimmedQuery = sampleQuery.trim().slice(0, 200)
  if (!trimmedQuery) return { error: 'Provide a sample search query to test against.' }

  const retailer = await prisma.retailer.findUnique({ where: { id } })
  if (!retailer) return { error: 'Retailer not found.' }
  if (retailer.type !== 'generic-html' || !retailer.config) {
    return { error: 'Only agent-onboarded storefronts can be auto-repaired.' }
  }

  let config: GenericHtmlConfig
  try {
    config = JSON.parse(retailer.config) as GenericHtmlConfig
  } catch {
    return { error: 'Stored config is corrupted; remove and re-add the source.' }
  }

  const fixed = await repairGenericAdapter(retailer.identifier, config, trimmedQuery)
  if (!fixed) return { error: 'Agent could not infer a fix from the search page.' }

  await prisma.retailer.update({
    where: { id },
    data: { config: JSON.stringify(fixed), lastError: null },
  })
  revalidatePath('/sources')
  revalidatePath('/')
  return { ok: true }
}
