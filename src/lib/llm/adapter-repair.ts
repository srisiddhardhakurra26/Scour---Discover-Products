import { generateJson } from './client'
import type { GenericHtmlConfig } from './source-onboarder'

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

const SYSTEM = `You repair a broken e-commerce scraper config.

You are given:
- The storefront's domain
- The current GenericHtmlConfig (which produced 0 results)
- The HTML of the search results page for a sample query

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
- Only change selectors that look wrong against the HTML. Keep working ones identical.
- Use stable class-based selectors a CSS engine (cheerio) can run.
- If the searchUrlTemplate produces a non-search page in the HTML, propose a corrected URL.
- Output ONLY the JSON object — no commentary.`

async function fetchSearchPage(
  domain: string,
  searchUrlTemplate: string,
  query: string,
): Promise<{ status: number; html: string }> {
  const url = searchUrlTemplate.replace('{query}', encodeURIComponent(query))
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': REALISTIC_UA,
      referer: `https://${domain}/`,
    },
  })
  const html = await res.text().catch(() => '')
  return { status: res.status, html }
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
  let page: { status: number; html: string }
  try {
    page = await fetchSearchPage(domain, config.searchUrlTemplate, sampleQuery)
  } catch (err) {
    console.error('[adapter-repair] fetch:', err)
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
          `HTTP status: ${page.status}\n` +
          `Current config:\n${JSON.stringify(config, null, 2)}\n\n` +
          `Search results HTML (truncated):\n${truncate(page.html)}`,
        tier: 'reasoning',
        maxTokens: 800,
      },
      AbortSignal.timeout(25_000),
    )
  } catch (err) {
    console.error('[adapter-repair] llm:', err)
    return null
  }

  try {
    return validate(JSON.parse(json))
  } catch (err) {
    console.error('[adapter-repair] parse:', err)
    return null
  }
}
