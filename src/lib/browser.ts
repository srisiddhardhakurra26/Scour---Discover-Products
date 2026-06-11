import type { Browser, BrowserContext, Page } from 'playwright'

// Lazy, process-wide Chromium instance. We launch once on first use and
// reuse the browser across requests; only the per-request context is
// recreated. Killing this saves ~150-300MB of RSS.

let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright')
      return chromium.launch({
        headless: true,
        args: [
          // Docker's /dev/shm defaults to 64MB; without this Chromium can crash.
          '--disable-dev-shm-usage',
          // The container runs as root, where Chromium refuses to start unless
          // the sandbox is disabled. Opt-in via env so local dev keeps it on.
          ...(process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : []),
        ],
      })
    })()
  }
  return browserPromise
}

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export type RenderedPage = {
  status: number
  html: string
  /** True if we can tell the page rendered content only after JS ran. */
  jsRendered: boolean
}

/**
 * Visit a URL with a real Chromium and return the post-render HTML. Used by
 * the onboarder and repair agents so they see the same DOM a user would.
 */
export async function renderPage(url: string, timeoutMs = 15_000): Promise<RenderedPage> {
  return renderInternal(url, timeoutMs, false)
}

/**
 * renderPage plus a viewport screenshot (JPEG), for the vision-grounded
 * repair path: the model reads the pixels, the HTML maps them to selectors.
 */
export async function renderPageWithScreenshot(
  url: string,
  timeoutMs = 20_000,
): Promise<RenderedPage & { screenshot: Buffer }> {
  const page = await renderInternal(url, timeoutMs, true)
  return page as RenderedPage & { screenshot: Buffer }
}

async function renderInternal(
  url: string,
  timeoutMs: number,
  screenshot: boolean,
): Promise<RenderedPage & { screenshot?: Buffer }> {
  const browser = await getBrowser()
  let context: BrowserContext | null = null
  let page: Page | null = null
  try {
    context = await browser.newContext({
      userAgent: REALISTIC_UA,
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    })
    page = await context.newPage()
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })
    // Quick beat to let SPAs finish their first paint without waiting for the
    // entire networkidle (which some retail sites never reach because of
    // tracking pings).
    await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {})
    await page.waitForTimeout(1500)
    const initialHtml = await page.content()
    return {
      status: response?.status() ?? 0,
      html: initialHtml,
      jsRendered: true,
      ...(screenshot
        ? { screenshot: await page.screenshot({ type: 'jpeg', quality: 60 }) }
        : {}),
    }
  } finally {
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
  }
}

/** Strict heuristic: did the plain-fetch HTML look like a JS-app shell? */
export function looksLikeJsShell(html: string): boolean {
  // Tiny page with framework markers but no product-like words.
  const len = html.length
  if (len < 10_000) return true
  const hasReactRoot = /id=["']?(root|__next|app)["']?/.test(html)
  const hasProductIsh = /\b(price|product|cart|add to)\b/i.test(html)
  return hasReactRoot && !hasProductIsh
}

const BLOCK_MARKERS = [
  'captcha',
  'are you a robot',
  'verify you are human',
  'verify you are a human',
  'access denied',
  'access to this page has been denied',
  'unusual traffic',
  'detected unusual activity',
  'cf-browser-verification',
  'cf-challenge',
  '/cdn-cgi/challenge-platform',
  'just a moment...',
  'attention required',
  'px-captcha',
  'perimeterx',
  'request blocked',
  'pardon our interruption',
  'enable javascript and cookies to continue',
  'ddos protection by',
  'checking your browser before',
]

/**
 * Heuristic: is this HTML a bot-challenge / access-denied interstitial rather
 * than real content? Used to avoid firing the (expensive) repair agent — and
 * worse, fitting selectors to junk — when a source is simply blocking us.
 * Conservative: matches well-known markers from Cloudflare, PerimeterX, Akamai,
 * and explicit captcha / "verify you're human" prompts.
 */
export function looksLikeBlockPage(html: string): boolean {
  const h = html.toLowerCase()
  return BLOCK_MARKERS.some((m) => h.includes(m))
}

// Enterprise bot protection (Akamai, Cloudflare) often rejects automated
// browsers below HTTP: the TLS/HTTP2 handshake is fingerprinted and the
// connection killed before any HTML exists. Those failures surface as
// protocol/connection errors rather than status codes or block pages.
const BLOCK_ERROR_RE =
  /(bot-blocked|ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ECONNRESET|HTTP 403\b|^403\b|\b403:)/i

/**
 * Does this error message look like the site refusing automated access
 * (connection-level kill or 403), as opposed to a timeout or DNS failure?
 */
export function isBotBlockSignal(message: string): boolean {
  return BLOCK_ERROR_RE.test(message)
}
