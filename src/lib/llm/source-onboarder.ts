import { generateJson } from './client'

export type GenericHtmlConfig = {
  /** Template with literal `{query}` to interpolate the user's search. */
  searchUrlTemplate: string
  /** CSS selector for each product card on the search page. */
  productSelector: string
  /** CSS selector (relative to a card) for the product title. */
  titleSelector: string
  /** CSS selector for the price element; the parser will extract $X.XX. */
  priceSelector: string
  /** CSS selector for the product image; `src` or `data-src` is read. */
  imageSelector: string
  /** CSS selector for the link; `href` is read. */
  urlSelector: string
  /** Prepended to relative URLs (e.g. "https://example.com"). */
  urlPrefix?: string
  /** Currency code if non-USD. */
  currency?: string
  /** Brand inferred from the storefront (used as default sellerName). */
  brandName?: string
}

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

const SYSTEM = `You inspect an e-commerce storefront's homepage HTML and produce
a JSON config that another scraper can use to extract product cards from its
search page.

Return ONLY a JSON object with these keys:
  searchUrlTemplate: string  // a URL with the literal "{query}" placeholder
  productSelector: string    // CSS selector matching each product card on the search results page
  titleSelector: string      // relative to a card, the product title element
  priceSelector: string      // relative to a card, the price element (parser extracts $X.XX)
  imageSelector: string      // relative to a card, the image element
  urlSelector: string        // relative to a card, the anchor to the product page
  urlPrefix: string?         // prepended to relative URLs, e.g. "https://example.com"
  currency: string?          // 3-letter ISO if non-USD
  brandName: string?         // store/brand name

Rules:
- Pick selectors a CSS engine (cheerio) can run. No XPath, no :has() unless necessary.
- Prefer stable class-based selectors over deeply-nested positional ones.
- searchUrlTemplate examples: "https://example.com/search?q={query}", "https://example.com/shop?s={query}"
- If you can't tell, GUESS based on the platform (Shopify often has /search?q=, WooCommerce has /?s=).
- Do not return any text outside the JSON object.`

async function fetchHomepage(domain: string): Promise<string> {
  const res = await fetch(`https://${domain}/`, {
    signal: AbortSignal.timeout(8000),
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': REALISTIC_UA,
    },
  })
  if (!res.ok) throw new Error(`homepage HTTP ${res.status}`)
  return res.text()
}

function truncate(html: string, max = 24000): string {
  if (html.length <= max) return html
  // Keep <head> + the first chunk of <body>; that's usually enough to spot
  // platform + nav patterns. Strip scripts/styles first.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
  if (stripped.length <= max) return stripped
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
 * Inspect a storefront's homepage and produce a generic-html adapter config.
 * Returns null if the LLM can't produce a valid config or the fetch fails.
 */
export async function onboardSource(domain: string): Promise<GenericHtmlConfig | null> {
  let html: string
  try {
    html = await fetchHomepage(domain)
  } catch (err) {
    console.error('[source-onboarder] homepage fetch:', err)
    return null
  }

  let json: string
  try {
    json = await generateJson(
      {
        system: SYSTEM,
        user: `Domain: ${domain}\n\nHomepage HTML (truncated):\n${truncate(html)}`,
        tier: 'reasoning',
        maxTokens: 800,
      },
      AbortSignal.timeout(20_000),
    )
  } catch (err) {
    console.error('[source-onboarder] llm:', err)
    return null
  }

  try {
    return validate(JSON.parse(json))
  } catch (err) {
    console.error('[source-onboarder] parse:', err)
    return null
  }
}
