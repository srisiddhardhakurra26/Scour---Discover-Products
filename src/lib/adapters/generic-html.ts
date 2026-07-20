import type { Adapter, NormalizedListing } from './types'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'
import { extractListings } from './generic-extract'
import { diagnoseZeroResults } from './diagnose'
import { repairGenericAdapter } from '@/lib/llm/adapter-repair'
import { renderPage, looksLikeJsShell } from '@/lib/browser'
import { prisma } from '@/lib/db'
import { fetchSafeRemote, isStorefrontUrl } from '@/lib/url-safety'
import { readTextLimited } from '@/lib/http'

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

/** Fetch (or render) the search-results HTML for a config + query. */
export async function loadSearchHtml(
  config: GenericHtmlConfig,
  query: string,
  domain: string,
  label: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!isStorefrontUrl(config.searchUrlTemplate, domain, { requireQueryPlaceholder: true })) {
    throw new Error(`${label}: unsafe search URL template`)
  }
  const url = config.searchUrlTemplate.replace('{query}', encodeURIComponent(query))

  let html: string
  if (config.requiresJs) {
    // Render with Chromium so SPA-rendered cards exist in the DOM.
    const rendered = await renderPage(url, 18_000)
    html = rendered.html
  } else {
    const res = await fetchSafeRemote(url, {
      signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': REALISTIC_UA,
        referer: `https://${domain}/`,
      },
    })
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
    html = await readTextLimited(res, 6_000_000)

    // Plain fetch returned a JS shell, or nothing extractable.
    // Re-render with Chromium and try again. This catches sites where the
    // onboarder happened to verify against a partly-SSR'd page but real
    // queries return content-light shells that need JS to populate.
    if (extractListings(html, config, domain, label).length === 0 || looksLikeJsShell(html)) {
      const rendered = await renderPage(url, 18_000)
      html = rendered.html
    }
  }
  return html
}

// Retailers currently being auto-repaired, keyed by id. A search that finds 0
// results triggers the repair agent; concurrent searches for the same retailer
// (e.g. a quick re-query, or both result views) skip it so we never run the
// expensive Playwright+LLM repair more than once at a time per source.
const repairing = new Set<string>()

/**
 * Run the repair agent once for a retailer that just returned 0 results,
 * persist the fix, and hand back the corrected config. Returns null if a
 * repair is already in flight or the agent couldn't produce a verified fix.
 */
async function autoRepair(
  id: string,
  domain: string,
  config: GenericHtmlConfig,
  query: string,
): Promise<GenericHtmlConfig | null> {
  if (repairing.has(id)) return null
  repairing.add(id)
  try {
    const fixed = await repairGenericAdapter(domain, config, query)
    if (!fixed) return null
    await prisma.retailer.update({
      where: { id },
      data: { config: JSON.stringify(fixed), lastError: null },
    })
    console.log(`[generic-html] auto-repaired ${domain}`)
    return fixed
  } catch (err) {
    console.error(`[generic-html] auto-repair ${domain}:`, err)
    return null
  } finally {
    repairing.delete(id)
  }
}

export function createGenericHtmlAdapter(
  id: string,
  label: string,
  domain: string,
  config: GenericHtmlConfig,
): Adapter {
  return {
    id,
    label,
    type: 'generic-html',
    async search(query, signal): Promise<NormalizedListing[]> {
      const html = await loadSearchHtml(config, query, domain, label, signal)
      const results = extractListings(html, config, domain, label)
      if (results.length > 0) return results

      // Zero results has three very different causes; only stale selectors are
      // worth the expensive repair agent. Repairing against a bot-challenge page
      // or a genuinely empty result set wastes a render + LLM round and can
      // corrupt a working config by fitting selectors to junk.
      if (diagnoseZeroResults(html, config) !== 'stale') return results

      // Self-heal: run the repair agent once, persist the fix, and retry
      // extraction with the corrected config in this same search.
      const fixed = await autoRepair(id, domain, config, query)
      if (!fixed) return results

      const retryHtml = await loadSearchHtml(fixed, query, domain, label, signal)
      return extractListings(retryHtml, fixed, domain, label)
    },
  }
}
