// Text-processing utilities for product matching.
// Goal: strip the noise that listing titles accumulate (prices, promo flags,
// retailer suffixes, bracket tags) so what's left is the actual product name —
// which is what we want the embedding to capture.

const RETAILER_NAMES = [
  'amazon',
  'target',
  'walmart',
  'best ?buy',
  'costco',
  'ebay',
  'newegg',
  'staples',
  'office ?depot',
  'home ?depot',
  'lowes',
].join('|')

const PROMO_PARENS_RE =
  /\(\s*(?:starts?\s|ends?\s|\d+%\s*off|ymmv|stack(?:able)?|coupon|promo|s\s*&\s*s|sns|ac\b|prime|new low|msrp|free shipping|after\s|with\s|w\/|launch|pre.?order|refurb(?:ished)?|pre.?owned|open box|used|new in box|nib|exp\s|expires|today only|deal of the day)[^)]*\)/gi

const BRACKET_TAG_RE = /^(?:\[[^\]]*\]\s*)+/

const ALL_BRACKETED_PROMO_RE =
  /\[\s*(?:s\s*&\s*s|sns|ac|deal|hot|amazon|target|walmart|expired|new|update)[^\]]*\]/gi

const PRICE_RE = /[$₹€£¥]\s*[\d]{1,3}(?:[,\d]{3})*(?:\.\d+)?\*?/g

const AT_RETAILER_RE = new RegExp(`\\s+(?:at|@|from|via|on)\\s+(?:${RETAILER_NAMES})(?:\\.com)?`, 'gi')

const FREE_SHIPPING_RE =
  /[+&]?\s*free\s+ship(?:ping)?(?:\s+(?:w\/?\s*\S+|on\s+\$?\d+\+?))?/gi

const W_SLASH_RE = /\bw\/(?:\s*\S+)+/gi

const PERCENT_OFF_RE = /\b\d{1,3}\s*%\s*off\b/gi

const STACKED_AFTER_COUPON =
  /\b(?:after\s+coupon|after\s+s&s|after\s+code|with\s+(?:code|coupon)|stack(?:ed|able)?|q's?\s+stacked|s&s\s+clip\s*q?\b)/gi

const TRAILING_PUNCT_RE = /[\s\-—:|*]+$/g
const LEADING_PUNCT_RE = /^[\s\-—:|*]+/g

const URGENCY_WORDS_RE = /\b(?:hot|deal|free|limited|today|now|new|sale|clearance|liquidation|flash|markdown)\b/gi

/**
 * Normalize a noisy listing title down to the product-name-essence we want to embed.
 * Keeps the model focused on what the product *is*, not the deal copy around it.
 *
 * Example:
 *   "[Headphones] Airpods Pro - $169 (Starts at 7PM EST 11/25) + Free Shipping w/ Prime"
 *     → "Airpods Pro"
 */
export function normalizeTitle(raw: string): string {
  if (!raw) return ''
  let s = raw

  // Drop full bracketed promo blocks anywhere
  s = s.replace(ALL_BRACKETED_PROMO_RE, ' ')
  // Drop leading bracketed tags
  s = s.replace(BRACKET_TAG_RE, '')
  // Drop parenthetical promo info
  s = s.replace(PROMO_PARENS_RE, ' ')
  // Drop "after coupon", "stack", etc.
  s = s.replace(STACKED_AFTER_COUPON, ' ')
  // Drop "+ Free Shipping ..." trails
  s = s.replace(FREE_SHIPPING_RE, ' ')
  // Drop "w/ X" trails
  s = s.replace(W_SLASH_RE, ' ')
  // Drop "50% off"
  s = s.replace(PERCENT_OFF_RE, ' ')
  // Drop "at Amazon", "@ Target", etc.
  s = s.replace(AT_RETAILER_RE, ' ')
  // Drop dollar amounts (price-in-title is the deal hook, not the product name)
  s = s.replace(PRICE_RE, ' ')
  // Drop urgency words ("hot", "deal", "sale", etc.)
  s = s.replace(URGENCY_WORDS_RE, ' ')
  // Collapse leftover punctuation
  s = s.replace(LEADING_PUNCT_RE, '').replace(TRAILING_PUNCT_RE, '')
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()

  // Safety: if normalization wiped almost everything, fall back to the raw title.
  if (s.length < 4 && raw.length >= 4) return raw.trim()
  return s
}

/** Lowercased query tokens (>= 3 chars) required to appear in a title. */
export function meaningfulTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

/** Does a query token appear in a (lowercased) title, allowing plural→singular? */
export function tokenMatchesTitle(token: string, titleLower: string): boolean {
  if (titleLower.includes(token)) return true
  if (token.endsWith('s') && token.length > 3 && titleLower.includes(token.slice(0, -1))) {
    return true
  }
  return false
}

/**
 * Token-overlap guard for a single title. For a single-word query, the token
 * (or its singular form) must appear in the title. For a multi-word query,
 * *every* meaningful (>= 3 char) token must appear — otherwise "fitbit air"
 * matches any title containing "air" (e.g. "AirPods") on embedding similarity
 * alone.
 */
export function hasTokenOverlap(query: string, title: string): boolean {
  const qTokens = meaningfulTokens(query)
  if (qTokens.length === 0) return true
  const tLower = title.toLowerCase()
  return qTokens.every((t) => tokenMatchesTitle(t, tLower))
}

/**
 * Same guard across a cluster: every meaningful token must appear in at least
 * one listing title (not necessarily the same one). Stops "fitbit air" from
 * surfacing AirPods clusters because "air" alone happens to be semantically
 * close.
 */
export function clusterHasTokenOverlap(query: string, titles: string[]): boolean {
  const qTokens = meaningfulTokens(query)
  if (qTokens.length === 0) return true
  const lowered = titles.map((t) => t.toLowerCase())
  return qTokens.every((tok) => lowered.some((title) => tokenMatchesTitle(tok, title)))
}

/** Extract a 10-char Amazon ASIN from a URL (anywhere — /dp/, /gp/product/, raw, etc.) */
export function extractASIN(url: string | undefined): string | null {
  if (!url) return null
  const m = url.match(/(?:\/dp\/|\/gp\/product\/|\/dp%2F|\/product\/|^|[?&]asin=)(B0[A-Z0-9]{8})\b/i)
  return m ? m[1].toUpperCase() : null
}
