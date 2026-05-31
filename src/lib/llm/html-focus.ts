import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'

// Anything that looks like a price: a currency-prefixed number or a decimal
// amount. Used to spot product-card-like elements without knowing selectors.
const PRICE_RE = /(?:[$£€¥]\s?\d|\d+[.,]\d{2})/

/** Strip bulky, semantically-useless attributes that bloat card markup. */
function stripBulkyAttrs(html: string): string {
  return html
    .replace(/\s(?:srcset|sizes|style|fetchpriority|loading|decoding|crossorigin|tabindex|aria-[\w-]+)="[^"]*"/gi, '')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()
}

/**
 * Locate the product grid in a (potentially huge, JS-rendered) search page,
 * selector-agnostically so it works on any storefront:
 *   1. Drop scripts/styles/chrome (head, header, nav, footer).
 *   2. Find every element that contains both an `<a href>` and price-like text
 *      and isn't itself huge — these are product-card candidates.
 *   3. The DOM parent with the most such children is the product grid.
 *
 * Returns the grid's markup and how many cards it holds, or null when no
 * repeated priced-card structure is present (e.g. a "no results" page, or a
 * search page that lists categories rather than products).
 */
export function locateProductGrid(html: string): { html: string; count: number } | null {
  let $: cheerio.CheerioAPI
  try {
    $ = cheerio.load(html)
  } catch {
    return null
  }
  $('script, style, svg, noscript, head, header, footer, nav').remove()

  const byParent = new Map<AnyNode, number>()
  let bestParent: AnyNode | null = null
  let bestCount = 0

  $('*').each((_i, el) => {
    const $el = $(el)
    const text = $el.text()
    // Skip giant containers; we want card-sized elements.
    if (text.length > 1500) return
    if ($el.find('a[href]').length === 0) return
    if (!PRICE_RE.test(text)) return
    const parent = el.parent
    if (!parent) return
    const n = (byParent.get(parent) ?? 0) + 1
    byParent.set(parent, n)
    if (n > bestCount) {
      bestCount = n
      bestParent = parent
    }
  })

  // Need a few repeated cards to trust that we found a real grid.
  if (!bestParent || bestCount < 3) return null
  return { html: $.html(bestParent as AnyNode), count: bestCount }
}

/**
 * Reduce a search-results page to the HTML of just the product grid, so an LLM
 * asked for card selectors actually sees the cards instead of the page chrome.
 * Falls back to a cleaned head-of-document slice when no grid is found, so
 * callers always get usable HTML.
 */
export function focusSearchHtml(html: string, max = 20000): string {
  const grid = locateProductGrid(html)
  if (grid) return stripBulkyAttrs(grid.html).slice(0, max)

  let $: cheerio.CheerioAPI
  try {
    $ = cheerio.load(html)
  } catch {
    return plainTruncate(html, max)
  }
  $('script, style, svg, noscript, head, header, footer, nav').remove()
  return plainTruncate(stripBulkyAttrs($.html()), max)
}

function plainTruncate(html: string, max: number): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
  return stripped.slice(0, max)
}
