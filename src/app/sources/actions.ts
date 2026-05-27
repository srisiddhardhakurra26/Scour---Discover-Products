'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  let host: string
  try {
    const u = trimmed.startsWith('http') ? new URL(trimmed) : new URL(`https://${trimmed}`)
    host = u.hostname
  } catch {
    return null
  }
  if (!host.includes('.')) return null
  return host
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

  // Try Shopify first
  try {
    const res = await fetch(`https://${domain}/products.json?limit=1`, {
      signal: AbortSignal.timeout(6000),
      headers,
    })
    if (res.ok) {
      const data = (await res.json()) as { products?: unknown }
      if (Array.isArray(data.products)) return { ok: true, type: 'shopify' }
    }
  } catch {
    // ignore, try woocommerce
  }

  // Fall back to WooCommerce Store API
  try {
    const res = await fetch(`https://${domain}/wp-json/wc/store/v1/products?per_page=1`, {
      signal: AbortSignal.timeout(6000),
      headers,
    })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) return { ok: true, type: 'woocommerce' }
    }
  } catch {
    // ignore
  }

  // Final check: was Shopify blocked specifically? Give a more useful message.
  try {
    const res = await fetch(`https://${domain}/products.json?limit=1`, {
      signal: AbortSignal.timeout(6000),
      headers,
    })
    if (res.status === 403) {
      return {
        ok: false,
        message: 'Storefront is blocking automated requests (Cloudflare / bot protection).',
      }
    }
  } catch {}

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
  const labelRaw = String(formData.get('label') ?? '').trim()
  const domain = normalizeDomain(raw)
  if (!domain) return { error: 'Enter a valid domain (e.g. allbirds.com).' }

  const detect = await detectStoreType(domain)
  if (!detect.ok) return { error: detect.message }

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

export async function toggleRetailer(id: string, enabled: boolean) {
  await prisma.retailer.update({ where: { id }, data: { enabled } })
  revalidatePath('/sources')
  revalidatePath('/')
}

export async function removeRetailer(id: string) {
  await prisma.retailer.delete({ where: { id } })
  revalidatePath('/sources')
  revalidatePath('/')
}
