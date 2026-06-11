import * as cheerio from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import { generateJsonVision } from './client'
import type { GenericHtmlConfig } from './source-onboarder'
import { extractListings } from '@/lib/adapters/generic-extract'
import { looksLikeBlockPage, renderPageWithScreenshot } from '@/lib/browser'

// Vision-grounded selector derivation: HTML-only repair fails on stores with
// hashed/obfuscated class names, because the LLM can't tell which <div> soup
// is a product card. Pixels can. The vision model reads the rendered page's
// product cards (exact title/price strings), those strings are located in the
// DOM, and selectors are generalized from the real nodes — then verified by
// running the actual extraction. Used as the last-resort stage of both the
// onboarder and the repair agent.

const SYSTEM = `You read a screenshot of an e-commerce search results page.

Return ONLY a JSON object: {"products": [{"title": string, "price": string | null}]}

Rules:
- List the first 6 (or fewer) product cards visible, in reading order.
- title: the product's display title EXACTLY as shown — same casing, same words. If it is visually truncated, include only what is visible (without the trailing ellipsis).
- price: the price text exactly as displayed (e.g. "$89.95"), or null if no price is visible on the card.
- If the page is a captcha/error/empty-results page with no product cards, return {"products": []}.`

type VisionSample = { title: string; price: string | null }

const PRICE_RE = /(?:[$£€¥]\s?\d|\d+[.,]\d{2})/

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[…]+$/, '').trim()
}

function textMatches(elText: string, want: string): boolean {
  const a = norm(elText)
  const b = norm(want)
  if (a.length < 8 || b.length < 8) return a === b
  return a === b || a.startsWith(b) || b.startsWith(a)
}

function tagOf(el: Element): string {
  return el.tagName?.toLowerCase() ?? ''
}

// Only plain class names survive into selectors — Tailwind's bracket/colon
// classes would need escaping and obfuscated one-offs don't generalize.
function safeClasses($el: cheerio.Cheerio<AnyNode>): Set<string> {
  const raw = ($el.attr('class') ?? '').split(/\s+/)
  return new Set(raw.filter((c) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(c) && c.length > 1))
}

/** Smallest element whose text matches the sample title. */
function findTitleNode($: cheerio.CheerioAPI, title: string): Element | null {
  let best: Element | null = null
  let bestLen = Infinity
  $('body *').each((_i, el) => {
    const $el = $(el)
    const text = $el.text()
    if (text.length > 300 || !textMatches(text, title)) return
    if (text.length < bestLen) {
      best = el
      bestLen = text.length
    }
  })
  return best
}

/** Walk up from the title node to the smallest ancestor that looks like a
 * complete card: contains a link and price-like text, isn't page-sized. */
function findCardRoot($: cheerio.CheerioAPI, titleEl: Element): Element | null {
  let node: Element | null = titleEl
  while (node) {
    const $node = $(node)
    const text = $node.text()
    if (text.length > 1500) return null
    if ($node.find('a[href]').length > 0 && PRICE_RE.test(text)) return node
    node = node.parent && (node.parent as Element).tagName ? (node.parent as Element) : null
  }
  return null
}

/** Smallest descendant of the card whose own text is price-shaped. */
function findPriceNode($: cheerio.CheerioAPI, card: Element): Element | null {
  let best: Element | null = null
  let bestLen = Infinity
  $(card)
    .find('*')
    .each((_i, el) => {
      const text = $(el).text().trim()
      if (!PRICE_RE.test(text) || text.length > 25) return
      if (text.length < bestLen) {
        best = el
        bestLen = text.length
      }
    })
  return best
}

/** Generalize one selector from the sample nodes: shared tag + shared safe
 * classes; a bare semantic tag when no classes survive. */
function commonSelector($: cheerio.CheerioAPI, els: Element[]): string | null {
  if (els.length === 0) return null
  const tag = tagOf(els[0])
  if (!tag || !els.every((e) => tagOf(e) === tag)) return null
  let common = safeClasses($(els[0]))
  for (const el of els.slice(1)) {
    const cls = safeClasses($(el))
    common = new Set([...common].filter((c) => cls.has(c)))
  }
  if (common.size > 0) return `${tag}.${[...common].slice(0, 3).join('.')}`
  // A bare structural tag matches far too much; bare semantic tags are fine
  // because extraction verifies title+link per match anyway.
  return ['div', 'span', 'a', 'p', 'section'].includes(tag) ? null : tag
}

function dedupe(samples: VisionSample[]): VisionSample[] {
  const seen = new Set<string>()
  return samples.filter((s) => {
    const k = norm(s.title)
    if (!k || k.length < 4 || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

async function readCardsFromScreenshot(screenshot: Buffer): Promise<VisionSample[]> {
  const json = await generateJsonVision(
    {
      system: SYSTEM,
      user: 'Read the product cards in this screenshot.',
      images: [{ mimeType: 'image/jpeg', dataBase64: screenshot.toString('base64') }],
      maxTokens: 700,
    },
    AbortSignal.timeout(25_000),
  )
  const parsed = JSON.parse(json) as { products?: Array<{ title?: unknown; price?: unknown }> }
  if (!Array.isArray(parsed.products)) return []
  return dedupe(
    parsed.products
      .filter((p) => typeof p.title === 'string' && p.title.trim())
      .map((p) => ({
        title: (p.title as string).trim(),
        price: typeof p.price === 'string' ? p.price : null,
      })),
  )
}

/**
 * Derive a verified GenericHtmlConfig by looking at the rendered page.
 * Returns null when the model can't see cards, the cards can't be anchored
 * in the DOM, or the derived selectors fail real extraction.
 */
export async function visionDeriveConfig(
  domain: string,
  searchUrlTemplate: string,
  query: string,
  base: { urlPrefix?: string; currency?: string; brandName?: string },
): Promise<GenericHtmlConfig | null> {
  if (!process.env.GEMINI_API_KEY) return null

  const url = searchUrlTemplate.replace('{query}', encodeURIComponent(query))
  let rendered: Awaited<ReturnType<typeof renderPageWithScreenshot>>
  try {
    rendered = await renderPageWithScreenshot(url, 25_000)
  } catch (err) {
    console.warn('[vision-locate] render:', err instanceof Error ? err.message : err)
    return null
  }
  if (rendered.status >= 400 || looksLikeBlockPage(rendered.html)) return null

  let samples: VisionSample[]
  try {
    samples = await readCardsFromScreenshot(rendered.screenshot)
  } catch (err) {
    console.warn('[vision-locate] vision:', err instanceof Error ? err.message : err)
    return null
  }
  if (samples.length < 2) return null

  // Anchor each sample title in the DOM and resolve its card.
  const $ = cheerio.load(rendered.html)
  const cards: Element[] = []
  const titleNodes: Element[] = []
  const priceNodes: Element[] = []
  for (const s of samples) {
    const titleEl = findTitleNode($, s.title)
    if (!titleEl) continue
    const card = findCardRoot($, titleEl)
    if (!card) continue
    cards.push(card)
    titleNodes.push(titleEl)
    const priceEl = findPriceNode($, card)
    if (priceEl) priceNodes.push(priceEl)
  }
  if (cards.length < 2) {
    console.warn(`[vision-locate] ${domain}: anchored ${cards.length}/${samples.length} cards — giving up`)
    return null
  }

  const productSelector = commonSelector($, cards)
  const titleSelector = commonSelector($, titleNodes)
  const priceSelector = priceNodes.length >= 2 ? commonSelector($, priceNodes) : null
  if (!productSelector || !titleSelector) return null

  const config: GenericHtmlConfig = {
    searchUrlTemplate,
    productSelector,
    titleSelector,
    priceSelector: priceSelector ?? titleSelector,
    imageSelector: 'img',
    urlSelector: 'a[href]',
    urlPrefix: base.urlPrefix,
    currency: base.currency,
    brandName: base.brandName,
    requiresJs: true,
  }

  const extracted = extractListings(rendered.html, config, domain, base.brandName ?? domain)
  if (extracted.length < 2) {
    console.warn(
      `[vision-locate] ${domain}: derived selectors only extracted ${extracted.length} listings — rejecting`,
    )
    return null
  }
  console.log(
    `[vision-locate] ${domain}: vision-derived config verified (${extracted.length} listings, product=${productSelector})`,
  )
  return config
}
