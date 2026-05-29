import { generateJson } from './client'
import type { GenericHtmlConfig } from './source-onboarder'
import { renderPage } from '@/lib/browser'

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

function validate(raw: unknown): GenericHtmlConfig | null {
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
    if (typeof obj[k] !== 'string' || !(obj[k] as string).trim()) return null
  }
  const cfg: GenericHtmlConfig = {
    searchUrlTemplate: (obj.searchUrlTemplate as string).trim(),
    productSelector: (obj.productSelector as string).trim(),
    titleSelector: (obj.titleSelector as string).trim(),
    priceSelector: (obj.priceSelector as string).trim(),
    imageSelector: (obj.imageSelector as string).trim(),
    urlSelector: (obj.urlSelector as string).trim(),
  }
  if (!cfg.searchUrlTemplate.includes('{query}')) return null
  if (typeof obj.urlPrefix === 'string' && obj.urlPrefix.trim()) {
    cfg.urlPrefix = obj.urlPrefix.trim().replace(/\/+$/, '')
  }
  if (typeof obj.currency === 'string' && obj.currency.trim().length === 3) {
    cfg.currency = obj.currency.trim().toUpperCase()
  }
  if (typeof obj.brandName === 'string' && obj.brandName.trim()) {
    cfg.brandName = obj.brandName.trim()
  }
  if (obj.requiresJs === true) cfg.requiresJs = true
  return cfg
}

/**
 * Re-run the onboarder against the search-results page using the current
 * config and a sample query. Returns an updated config if the LLM produced
 * one that validates, otherwise null.
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

  let json: string
  try {
    json = await generateJson(
      {
        system: SYSTEM,
        user:
          `Domain: ${domain}\n` +
          `Sample query: ${sampleQuery}\n` +
          `Search HTTP status: ${pages.search.status}\n` +
          `Current config:\n${JSON.stringify(config, null, 2)}\n\n` +
          `--- HOMEPAGE HTML (truncated) ---\n${truncate(pages.homepage, 12000)}\n\n` +
          `--- SEARCH RESULTS HTML (truncated) ---\n${truncate(pages.search.html, 14000)}`,
        tier: 'reasoning',
        maxTokens: 800,
      },
      AbortSignal.timeout(40_000),
    )
  } catch (err) {
    console.error('[adapter-repair] llm:', err)
    return null
  }

  try {
    const fixed = validate(JSON.parse(json))
    if (!fixed) return null
    // Repair always runs Playwright, so the new config is JS-rendered too.
    fixed.requiresJs = true
    return fixed
  } catch (err) {
    console.error('[adapter-repair] parse:', err)
    return null
  }
}
