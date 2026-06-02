import * as cheerio from 'cheerio'
import { looksLikeBlockPage } from '@/lib/browser'
import { locateProductGrid } from '@/lib/llm/html-focus'
import type { GenericHtmlConfig } from '@/lib/llm/source-onboarder'

/**
 * Why did extraction return zero listings?
 *  - 'blocked' — the page is a bot-challenge / access-denied interstitial.
 *  - 'empty'   — a real results page that genuinely has no products for the query.
 *  - 'stale'   — products are on the page but the stored selectors no longer
 *                capture them (a layout change). The only cause worth repairing.
 */
export type ZeroResultCause = 'blocked' | 'empty' | 'stale'

// Conservative phrases a no-results page tends to show. Kept tight to avoid
// misreading a populated page that merely contains the word "no".
const NO_RESULTS_RE =
  /\b(no results|no products|0 results|no matches|nothing found|did ?n[o']t match|could ?n[o']t find|we found 0)\b/i

export function hasNoResultsMarker(html: string): boolean {
  return NO_RESULTS_RE.test(html)
}

/**
 * Classify a zero-result search so callers can route it: repair only stale
 * selectors; never burn the repair agent on a block page (it would fit
 * selectors to a captcha and corrupt a working config) or on a legitimately
 * empty result set.
 */
export function diagnoseZeroResults(
  html: string,
  config: GenericHtmlConfig,
): ZeroResultCause {
  if (looksLikeBlockPage(html)) return 'blocked'
  if (hasNoResultsMarker(html)) return 'empty'

  // The configured card container still matches, yet extraction produced
  // nothing — the title/url selector moved within the card. Repairable.
  let containerMatches = 0
  try {
    containerMatches = cheerio.load(html)(config.productSelector).length
  } catch {
    containerMatches = 0
  }
  if (containerMatches > 0) return 'stale'

  // Our selector matched nothing. Are there product-like cards on the page at
  // all (selector-agnostic)? If so, the layout changed → repairable.
  if (locateProductGrid(html)) return 'stale'

  // No block, no products, no grid → treat as a genuinely empty result set.
  return 'empty'
}
