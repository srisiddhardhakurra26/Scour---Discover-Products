import { generateJson } from './client'
import type { GenericHtmlConfig } from './source-onboarder'
import { focusSearchHtml } from './html-focus'
import { extractListings } from '@/lib/adapters/generic-extract'
import { extractJsonLdListings } from '@/lib/adapters/jsonld'
import { renderPage } from '@/lib/browser'
import { isStorefrontUrl } from '@/lib/url-safety'

const SYSTEM = `You repair a broken e-commerce scraper config.

You are given:
- The storefront's domain
- The current GenericHtmlConfig (which produced 0 results)
- The HTML of the homepage (always)
- The HTML of the search results page for a sample query (status may be 4xx if the template is wrong)

Return a corrected JSON object with the same schema:
  searchUrlTemplate: string  // must include literal "{query}"
  productSelector: string
  titleSelector: string
  priceSelector: string
  imageSelector: string
  urlSelector: string
  urlPrefix: string?
  currency: string?
  brandName: string?

Rules:
- If the search HTTP status is 4xx/5xx, the searchUrlTemplate is wrong. Look at <form> elements in the homepage HTML (action= and input name=) to find the real search endpoint. E.g. nike.com uses /w?q={query}, amazon uses /s?k={query}.
- Use stable class-based selectors a CSS engine (cheerio) can run.
- Only change selectors that look wrong; keep working ones identical.
- Output ONLY the JSON object — no commentary.`

async function renderRepairPages(
  domain: string,
  searchUrlTemplate: string,
  query: string,
): Promise<{ homepage: string; search: { status: number; html: string } }> {
  if (!isStorefrontUrl(searchUrlTemplate, domain, { requireQueryPlaceholder: true })) {
    throw new Error('Unsafe search URL template')
  }
  // Always use Playwright for repair — handles JS-heavy sites and serves
  // identical content regardless of bot fingerprinting heuristics that vary
  // between fetch and a real browser.
  const homepage = await renderPage(`https://${domain}/`, 20_000)
  const searchUrl = searchUrlTemplate.replace('{query}', encodeURIComponent(query))
  const search = await renderPage(searchUrl, 25_000).catch((err) => ({
    status: 0,
    html: `<!-- render error: ${err instanceof Error ? err.message : String(err)} -->`,
    jsRendered: true,
  }))
  return { homepage: homepage.html, search: { status: search.status, html: search.html } }
}

function truncate(html: string, max = 24000): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
  return stripped.slice(0, max)
}

function validate(raw: unknown, domain: string): GenericHtmlConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const required = [
    'searchUrlTemplate',
    'productSelector',
    'titleSelector',
    'priceSelector',
    'imageSelector',
    'urlSelector',
  ] as const
  for (const k of required) {
    if (
      typeof obj[k] !== 'string' ||
      !(obj[k] as string).trim() ||
      (obj[k] as string).length > 500
    ) {
      return null
    }
  }
  const cfg: GenericHtmlConfig = {
    searchUrlTemplate: (obj.searchUrlTemplate as string).trim(),
    productSelector: (obj.productSelector as string).trim(),
    titleSelector: (obj.titleSelector as string).trim(),
    priceSelector: (obj.priceSelector as string).trim(),
    imageSelector: (obj.imageSelector as string).trim(),
    urlSelector: (obj.urlSelector as string).trim(),
  }
  if (!isStorefrontUrl(cfg.searchUrlTemplate, domain, { requireQueryPlaceholder: true })) {
    return null
  }
  if (typeof obj.urlPrefix === 'string' && obj.urlPrefix.trim()) {
    const prefix = obj.urlPrefix.trim().replace(/\/+$/, '')
    if (isStorefrontUrl(prefix, domain)) cfg.urlPrefix = prefix
  }
  if (typeof obj.currency === 'string' && /^[A-Za-z]{3}$/.test(obj.currency.trim())) {
    cfg.currency = obj.currency.trim().toUpperCase()
  }
  if (typeof obj.brandName === 'string' && obj.brandName.trim()) {
    cfg.brandName = obj.brandName.trim().slice(0, 100)
  }
  if (obj.requiresJs === true) cfg.requiresJs = true
  return cfg
}

async function askForFix(
  domain: string,
  config: GenericHtmlConfig,
  sampleQuery: string,
  pages: { homepage: string; search: { status: number; html: string } },
  retry?: { previous: GenericHtmlConfig; reason: string },
): Promise<GenericHtmlConfig | null> {
  const base =
    `Domain: ${domain}\n` +
    `Sample query: ${sampleQuery}\n` +
    `Search HTTP status: ${pages.search.status}\n` +
    `Current config:\n${JSON.stringify(config, null, 2)}\n\n` +
    `--- HOMEPAGE HTML (truncated) ---\n${truncate(pages.homepage, 12000)}\n\n` +
    `--- SEARCH RESULTS PRODUCT GRID ---\n${focusSearchHtml(pages.search.html)}`
  const user = retry
    ? `${base}\n\nYour previous fix was:\n${JSON.stringify(retry.previous)}\n\n` +
      `It still failed: ${retry.reason}\n\nReturn a corrected config.`
    : base

  let json: string
  try {
    json = await generateJson(
      { system: SYSTEM, user, tier: 'reasoning', maxTokens: 800 },
      AbortSignal.timeout(40_000),
    )
  } catch (err) {
    console.error('[adapter-repair] llm:', err)
    return null
  }

  try {
    const fixed = validate(JSON.parse(json), domain)
    if (!fixed) return null
    // Repair always runs Playwright, so the new config is JS-rendered too.
    fixed.requiresJs = true
    return fixed
  } catch (err) {
    console.error('[adapter-repair] parse:', err)
    return null
  }
}

/**
 * Re-run the onboarder against the search-results page using the current
 * config and a sample query. The proposed fix is verified against the actual
 * rendered search page — its productSelector must match at least one card —
 * before it's accepted, with one retry that feeds the failure back to the LLM.
 * Returns an updated, verified config, otherwise null.
 */
export async function repairGenericAdapter(
  domain: string,
  config: GenericHtmlConfig,
  sampleQuery: string,
): Promise<GenericHtmlConfig | null> {
  let pages: { homepage: string; search: { status: number; html: string } }
  try {
    pages = await renderRepairPages(domain, config.searchUrlTemplate, sampleQuery)
  } catch (err) {
    console.error('[adapter-repair] render:', err)
    return null
  }

  // Cheapest possible repair: the page embeds JSON-LD products, so broken
  // selectors can be abandoned for structured data — no LLM round needed.
  const jsonld = extractJsonLdListings(
    pages.search.html,
    domain,
    config.brandName ?? domain,
    config.currency,
  )
  if (jsonld.length >= 3) {
    console.log(`[adapter-repair] ${domain}: switching to JSON-LD extraction (${jsonld.length} products)`)
    return {
      searchUrlTemplate: config.searchUrlTemplate,
      extraction: 'jsonld',
      urlPrefix: config.urlPrefix,
      currency: config.currency,
      brandName: config.brandName,
      requiresJs: true,
    }
  }

  // Last-resort fallback shared by every failure below: derive selectors
  // from a screenshot of the rendered page (see vision-locate.ts). Pays off
  // exactly where HTML-only repair fails — hashed/obfuscated class names.
  const tryVision = async (): Promise<GenericHtmlConfig | null> => {
    const { visionDeriveConfig } = await import('./vision-locate')
    return visionDeriveConfig(domain, config.searchUrlTemplate, sampleQuery, {
      urlPrefix: config.urlPrefix,
      currency: config.currency,
      brandName: config.brandName,
    })
  }

  let fixed = await askForFix(domain, config, sampleQuery, pages)
  if (!fixed) return tryVision()

  // Verify the fix by running the *real* extraction against the rendered search
  // page. Matching productSelector alone isn't enough: a config can match cards
  // yet have a wrong title/url selector so every card is dropped, silently
  // returning 0 results again. We require at least one fully-extracted listing.
  const verifyExtracts = async (cfg: GenericHtmlConfig): Promise<number> => {
    let html = pages.search.html
    // If the LLM changed the search URL, the page we already rendered no longer
    // applies — render the new URL so we verify against what the adapter will
    // actually fetch.
    if (cfg.searchUrlTemplate !== config.searchUrlTemplate) {
      const url = cfg.searchUrlTemplate.replace('{query}', encodeURIComponent(sampleQuery))
      try {
        html = (await renderPage(url, 25_000)).html
      } catch {
        return 0
      }
    }
    return extractListings(html, cfg, domain, cfg.brandName ?? domain).length
  }

  let listings = await verifyExtracts(fixed)
  if (listings === 0) {
    console.warn(`[adapter-repair] fix extracted 0 listings — retrying`)
    const retry = await askForFix(domain, config, sampleQuery, pages, {
      previous: fixed,
      reason:
        `that config extracted 0 listings from the rendered search page. ` +
        `productSelector "${fixed.productSelector}" may match containers, but ` +
        `titleSelector "${fixed.titleSelector}" and/or urlSelector ` +
        `"${fixed.urlSelector}" produced empty values for every card. Pick ` +
        `selectors that actually contain the product title text and an <a href>.`,
    })
    if (!retry) return tryVision()
    fixed = retry
    listings = await verifyExtracts(fixed)
    if (listings === 0) {
      console.error(`[adapter-repair] fix still extracted 0 listings after retry`)
      return tryVision()
    }
  }

  console.log(`[adapter-repair] ${domain}: verified ${listings} listings extracted`)
  return fixed
}
