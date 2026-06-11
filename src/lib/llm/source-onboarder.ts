import { generateJson } from './client'
import { focusSearchHtml, locateProductGrid } from './html-focus'
import { isBotBlockSignal, looksLikeBlockPage, looksLikeJsShell, renderPage } from '@/lib/browser'
import { extractListings } from '@/lib/adapters/generic-extract'
import { extractJsonLdListings } from '@/lib/adapters/jsonld'

// A search page with at least this many JSON-LD products is trusted as a real
// results list (a single Product usually means a product-detail page).
const JSONLD_MIN_PRODUCTS = 3

export type GenericHtmlConfig = {
  /** Template with literal `{query}` to interpolate the user's search. */
  searchUrlTemplate: string
  /**
   * How listings are pulled from the search page. 'jsonld' reads
   * schema.org/Product structured data (no selectors needed, immune to
   * layout changes); 'selectors' (the default) uses the CSS selectors below.
   */
  extraction?: 'jsonld' | 'selectors'
  /** CSS selector for each product card on the search page. */
  productSelector?: string
  /** CSS selector (relative to a card) for the product title. */
  titleSelector?: string
  /** CSS selector for the price element; the parser will extract $X.XX. */
  priceSelector?: string
  /** CSS selector for the product image; `src` or `data-src` is read. */
  imageSelector?: string
  /** CSS selector for the link; `href` is read. */
  urlSelector?: string
  /** Prepended to relative URLs (e.g. "https://example.com"). */
  urlPrefix?: string
  /** Currency code if non-USD. */
  currency?: string
  /** Brand inferred from the storefront (used as default sellerName). */
  brandName?: string
  /** True when the site only renders products after running JavaScript. */
  requiresJs?: boolean
}

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

// Queries used to coax a store into rendering a product grid so we can read
// its card markup. "shoe" alone fails on any store that doesn't sell shoes
// (Apple, a coffee roaster, etc.), so we try several and stop at the first that
// actually returns products. The store's own brand name is tried first — most
// single-brand storefronts return their full catalog for it.
const GENERIC_VERIFY_QUERIES = ['sale', 'shirt', 'gift', 'bag', 'shoe']

function buildVerifyQueries(brand?: string): string[] {
  const queries: string[] = []
  if (brand) {
    const firstWord = brand.trim().split(/\s+/)[0]
    if (firstWord && firstWord.length >= 3) queries.push(firstWord.toLowerCase())
  }
  for (const q of GENERIC_VERIFY_QUERIES) {
    if (!queries.includes(q)) queries.push(q)
  }
  return queries
}

// Stage 1: from homepage, identify only the search URL pattern + brand info.
// We deliberately do NOT ask for selectors here, because the homepage almost
// never reveals what the search results page looks like.
const URL_SYSTEM = `You inspect an e-commerce site's homepage HTML and figure out how to reach its search results page.

Return ONLY a JSON object with these keys:
  searchUrlTemplate: string  // a URL with the literal "{query}" placeholder
  brandName: string?         // store/brand name (e.g. "Nike", "Best Buy")
  urlPrefix: string?         // prefix for relative URLs, e.g. "https://example.com"
  currency: string?          // 3-letter ISO if non-USD

Rules:
- Derive searchUrlTemplate from evidence in the HTML: search form actions, header search links, sitemap hints, platform tells.
- Common patterns: Shopify uses /search?q=, WooCommerce uses /?s=, Magento uses /catalogsearch/result?q=, Nike-style sites use /w?q=.
- Only fall back to a platform-default guess if no evidence is visible.
- Do not return any text outside the JSON object.`

// Stage 2: with the actual search results HTML in hand, ask for selectors.
// Now the LLM can see real card markup and pick selectors that will match.
const SELECTORS_SYSTEM = `You inspect an e-commerce site's SEARCH RESULTS page HTML and produce CSS selectors that a cheerio-based scraper can use to extract product cards.

Return ONLY a JSON object with these keys:
  productSelector: string    // matches each product card container on the page
  titleSelector: string      // relative to a card, the product title element
  priceSelector: string      // relative to a card, the price element (parser extracts $X.XX)
  imageSelector: string      // relative to a card, the image element
  urlSelector: string        // relative to a card, the anchor (<a>) to the product page

Rules:
- Selectors must work with cheerio. No XPath. Avoid :has() unless absolutely necessary.
- Prefer stable, semantic selectors. If the site uses hashed/obfuscated class names (React/Next.js style like .css-1abc23), use data-* attributes, href patterns (e.g. a[href*="/product/"]), or structural selectors instead.
- productSelector should match MULTIPLE elements on the page (one per product).
- Title/price/image/url selectors are evaluated relative to a single productSelector match.
- Do not return any text outside the JSON object.`

type UrlConfig = {
  searchUrlTemplate: string
  brandName?: string
  urlPrefix?: string
  currency?: string
}

type SelectorConfig = {
  productSelector: string
  titleSelector: string
  priceSelector: string
  imageSelector: string
  urlSelector: string
}

async function fetchHomepage(
  domain: string,
): Promise<{ html: string; requiresJs: boolean }> {
  let plainStatus: number | null = null
  try {
    const res = await fetch(`https://${domain}/`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': REALISTIC_UA,
      },
    })
    plainStatus = res.status
    if (res.ok) {
      const html = await res.text()
      if (!looksLikeJsShell(html)) return { html, requiresJs: false }
    }
  } catch {
    // fall through to Playwright
  }
  try {
    const rendered = await renderPage(`https://${domain}/`, 20_000)
    return { html: rendered.html, requiresJs: true }
  } catch (err) {
    // A render timeout alone is ambiguous (slow site?), but combined with the
    // plain fetch having been refused it's bot protection — Akamai-style
    // setups reject scripted fetches with assorted 4xx (403 to curl, 400 to
    // Node's TLS fingerprint) and stall automated browsers forever.
    const msg = err instanceof Error ? err.message : String(err)
    if (plainStatus !== null && plainStatus >= 400 && plainStatus < 500) {
      throw new Error(
        `bot-blocked: plain fetch refused with HTTP ${plainStatus}, render failed (${msg.slice(0, 80)})`,
      )
    }
    throw err
  }
}

/**
 * Fetch a URL and return its HTML, using Playwright when needed. Returns
 * `null` on HTTP error or fetch failure.
 */
async function fetchSearchPage(
  url: string,
  domain: string,
  forceJs: boolean,
): Promise<{ html: string; requiresJs: boolean } | { error: string }> {
  if (!forceJs) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent': REALISTIC_UA,
          referer: `https://${domain}/`,
        },
      })
      if (!res.ok) return { error: `HTTP ${res.status}` }
      const html = await res.text()
      if (!looksLikeJsShell(html)) return { html, requiresJs: false }
      // Fell through — page was a JS shell, fall back to Playwright.
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  try {
    const rendered = await renderPage(url, 18_000)
    if (rendered.status >= 400) return { error: `HTTP ${rendered.status}` }
    return { html: rendered.html, requiresJs: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function truncate(html: string, max = 24000): string {
  if (html.length <= max) return html
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
  if (stripped.length <= max) return stripped
  return stripped.slice(0, max)
}

function validateUrl(raw: unknown, domain: string): UrlConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.searchUrlTemplate !== 'string' || !obj.searchUrlTemplate.trim()) return null
  let tpl = obj.searchUrlTemplate.trim()
  if (!tpl.includes('{query}')) return null
  // The LLM often returns a relative template (e.g. "/us/search?q={query}").
  // A bare path can't be fetched and would crash the search-page step, so
  // anchor it to the domain.
  if (!/^https?:\/\//i.test(tpl)) {
    tpl = `https://${domain}${tpl.startsWith('/') ? '' : '/'}${tpl}`
  }
  const out: UrlConfig = { searchUrlTemplate: tpl }
  if (typeof obj.brandName === 'string' && obj.brandName.trim()) {
    out.brandName = obj.brandName.trim()
  }
  if (typeof obj.urlPrefix === 'string' && obj.urlPrefix.trim()) {
    out.urlPrefix = obj.urlPrefix.trim().replace(/\/+$/, '')
  }
  if (typeof obj.currency === 'string' && obj.currency.trim().length === 3) {
    out.currency = obj.currency.trim().toUpperCase()
  }
  return out
}

function validateSelectors(raw: unknown): SelectorConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const keys = [
    'productSelector',
    'titleSelector',
    'priceSelector',
    'imageSelector',
    'urlSelector',
  ] as const
  for (const k of keys) {
    if (typeof obj[k] !== 'string' || !(obj[k] as string).trim()) return null
  }
  return {
    productSelector: (obj.productSelector as string).trim(),
    titleSelector: (obj.titleSelector as string).trim(),
    priceSelector: (obj.priceSelector as string).trim(),
    imageSelector: (obj.imageSelector as string).trim(),
    urlSelector: (obj.urlSelector as string).trim(),
  }
}

async function askForUrl(
  domain: string,
  homepageHtml: string,
  retry?: { previous: UrlConfig; reason: string },
): Promise<UrlConfig | null> {
  const base = `Domain: ${domain}\n\nHomepage HTML (truncated):\n${truncate(homepageHtml)}`
  const user = retry
    ? `${base}\n\nYour previous attempt was:\n${JSON.stringify(retry.previous)}\n\nIt failed: ${retry.reason}\n\nReturn a corrected searchUrlTemplate.`
    : base
  let json: string
  try {
    json = await generateJson(
      { system: URL_SYSTEM, user, tier: 'reasoning', maxTokens: 400 },
      AbortSignal.timeout(20_000),
    )
  } catch (err) {
    console.error('[source-onboarder] url-llm:', err)
    return null
  }
  try {
    return validateUrl(JSON.parse(json), domain)
  } catch (err) {
    console.error('[source-onboarder] url-parse:', err)
    return null
  }
}

async function askForSelectors(
  domain: string,
  searchPageHtml: string,
  retry?: { previous: SelectorConfig; reason: string },
): Promise<SelectorConfig | null> {
  const base = `Domain: ${domain}\n\nSearch results page HTML (product grid):\n${focusSearchHtml(searchPageHtml)}`
  const user = retry
    ? `${base}\n\nYour previous selectors were:\n${JSON.stringify(retry.previous)}\n\nThey failed: ${retry.reason}\n\nReturn corrected selectors.`
    : base
  let json: string
  try {
    json = await generateJson(
      { system: SELECTORS_SYSTEM, user, tier: 'reasoning', maxTokens: 600 },
      AbortSignal.timeout(20_000),
    )
  } catch (err) {
    console.error('[source-onboarder] selectors-llm:', err)
    return null
  }
  try {
    return validateSelectors(JSON.parse(json))
  } catch (err) {
    console.error('[source-onboarder] selectors-parse:', err)
    return null
  }
}

export type OnboardResult =
  | { ok: true; config: GenericHtmlConfig }
  | {
      ok: false
      /** True when the store actively refuses automated access (bot protection). */
      blocked: boolean
      message: string
    }

const fail = (message: string, blocked = false): OnboardResult => ({ ok: false, blocked, message })

/**
 * Two-stage onboarding:
 *   1. From the homepage, identify the search URL pattern.
 *   2. Hit the search URL with a real query; prefer JSON-LD structured data,
 *      otherwise pick product-card selectors. Each stage is verified.
 *
 * Fails with `blocked: true` when the store's bot protection refuses access —
 * no amount of selector cleverness helps there, so callers should surface
 * that as a hard boundary rather than a retryable error.
 */
export async function onboardSource(domain: string): Promise<OnboardResult> {
  let homepage: { html: string; requiresJs: boolean }
  try {
    homepage = await fetchHomepage(domain)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[source-onboarder] homepage fetch:', err)
    if (isBotBlockSignal(message)) {
      return fail('the store blocks automated access (bot protection)', true)
    }
    return fail(`homepage could not be fetched (${message.slice(0, 120)})`)
  }
  if (looksLikeBlockPage(homepage.html)) {
    return fail('the store served a bot challenge instead of its homepage', true)
  }

  // ── Stage 1: search URL ──────────────────────────────────────────────
  let urlCfg = await askForUrl(domain, homepage.html)
  if (!urlCfg) return fail('could not infer a search URL from the homepage')

  // ── Stage 1.5: find a query that actually renders products ───────────
  // Try candidate queries until one returns a page with a product grid. Keep
  // the first page that merely fetched OK as a fallback, so a store whose grid
  // our heuristic can't spot still gets a shot at the selector stage.
  const queries = buildVerifyQueries(urlCfg.brandName)
  let chosen: { html: string; requiresJs: boolean } | null = null
  let fallback: { html: string; requiresJs: boolean } | null = null
  let verifyQuery = queries[0]
  let urlRetried = false
  let lastFetchError: string | null = null

  for (const q of queries) {
    let searchUrl = urlCfg.searchUrlTemplate.replace('{query}', encodeURIComponent(q))
    let page = await fetchSearchPage(searchUrl, domain, homepage.requiresJs)

    // A fetch error usually means the URL template is wrong, not the query —
    // retry the URL stage once, then re-fetch this same query.
    if ('error' in page && !urlRetried) {
      urlRetried = true
      console.warn(
        `[source-onboarder] search URL ${searchUrl} failed (${page.error}) — retrying URL stage`,
      )
      const retry = await askForUrl(domain, homepage.html, {
        previous: urlCfg,
        reason: `fetching ${searchUrl} failed: ${page.error}`,
      })
      if (retry) {
        urlCfg = retry
        searchUrl = urlCfg.searchUrlTemplate.replace('{query}', encodeURIComponent(q))
        page = await fetchSearchPage(searchUrl, domain, homepage.requiresJs)
      }
    }

    if ('error' in page) {
      lastFetchError = page.error
      continue
    }
    if (!fallback) {
      fallback = page
      verifyQuery = q
    }
    if (
      locateProductGrid(page.html) ||
      extractJsonLdListings(page.html, domain, domain).length >= JSONLD_MIN_PRODUCTS
    ) {
      chosen = page
      verifyQuery = q
      console.log(`[source-onboarder] ${domain}: product grid found for query "${q}"`)
      break
    }
  }

  const searchPage = chosen ?? fallback
  if (!searchPage) {
    console.error(`[source-onboarder] no search query returned a fetchable page for ${domain}`)
    if (lastFetchError && isBotBlockSignal(lastFetchError)) {
      return fail('the store blocks automated access (bot protection)', true)
    }
    return fail(
      `no search query returned a fetchable results page${lastFetchError ? ` (${lastFetchError.slice(0, 120)})` : ''}`,
    )
  }
  const searchUrl = urlCfg.searchUrlTemplate.replace('{query}', encodeURIComponent(verifyQuery))

  // ── Stage 2a: prefer JSON-LD over selectors when the page embeds it ──
  // Structured data is exact and survives layout redesigns, so it skips the
  // selector LLM round entirely and never needs selector repair.
  const requiresJsEarly = searchPage.requiresJs || homepage.requiresJs
  const jsonld = extractJsonLdListings(
    searchPage.html,
    domain,
    urlCfg.brandName ?? domain,
    urlCfg.currency,
  )
  if (jsonld.length >= JSONLD_MIN_PRODUCTS) {
    console.log(
      `[source-onboarder] ${domain}: ${jsonld.length} JSON-LD products on ${searchUrl} — using structured data`,
    )
    return {
      ok: true,
      config: {
        searchUrlTemplate: urlCfg.searchUrlTemplate,
        extraction: 'jsonld',
        urlPrefix: urlCfg.urlPrefix,
        currency: urlCfg.currency,
        brandName: urlCfg.brandName,
        requiresJs: requiresJsEarly,
      },
    }
  }

  // Last-resort fallback shared by every selector-stage failure below:
  // derive selectors from a screenshot of the rendered page (vision model
  // reads the cards, the DOM anchors them). See vision-locate.ts.
  const tryVision = async (): Promise<OnboardResult> => {
    const { visionDeriveConfig } = await import('./vision-locate')
    const config = await visionDeriveConfig(domain, urlCfg.searchUrlTemplate, verifyQuery, {
      urlPrefix: urlCfg.urlPrefix,
      currency: urlCfg.currency,
      brandName: urlCfg.brandName,
    })
    if (config) return { ok: true, config }
    return fail('could not derive working card selectors from the search page')
  }

  // ── Stage 2: selectors against the real search page ──────────────────
  let selectors = await askForSelectors(domain, searchPage.html)
  if (!selectors) return tryVision()

  const requiresJs = searchPage.requiresJs || homepage.requiresJs
  const buildConfig = (s: SelectorConfig): GenericHtmlConfig => ({
    searchUrlTemplate: urlCfg.searchUrlTemplate,
    productSelector: s.productSelector,
    titleSelector: s.titleSelector,
    priceSelector: s.priceSelector,
    imageSelector: s.imageSelector,
    urlSelector: s.urlSelector,
    urlPrefix: urlCfg.urlPrefix,
    currency: urlCfg.currency,
    brandName: urlCfg.brandName,
    requiresJs,
  })

  // Verify by running the *real* extraction — not just matching productSelector.
  // A selector can match card containers yet have a wrong title/url selector, so
  // every card is dropped: the source would onboard "green" then return 0 on the
  // first real search (and immediately trip auto-repair). Require at least one
  // fully-extracted listing, the same bar adapter-repair uses.
  const label = urlCfg.brandName ?? domain
  let listings = extractListings(searchPage.html, buildConfig(selectors), domain, label).length
  if (listings === 0) {
    console.warn(
      `[source-onboarder] selectors extracted 0 complete listings — retrying selector stage`,
    )
    const retry = await askForSelectors(domain, searchPage.html, {
      previous: selectors,
      reason:
        `those selectors extracted 0 complete listings from the actual search results page. ` +
        `productSelector "${selectors.productSelector}" may match containers, but ` +
        `titleSelector "${selectors.titleSelector}" and/or urlSelector "${selectors.urlSelector}" ` +
        `produced empty values for every card. Pick selectors whose elements actually contain ` +
        `the product title text and an <a href> to the product page.`,
    })
    if (!retry) return tryVision()
    selectors = retry
    listings = extractListings(searchPage.html, buildConfig(selectors), domain, label).length
    if (listings === 0) {
      console.error(
        `[source-onboarder] selectors still extracted 0 complete listings after retry`,
      )
      return tryVision()
    }
  }

  console.log(
    `[source-onboarder] ${domain}: ${listings} listings extracted on ${searchUrl}`,
  )

  return { ok: true, config: buildConfig(selectors) }
}
