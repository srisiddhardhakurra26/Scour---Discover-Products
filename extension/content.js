// Product-page overlay: extract title/price → ask Scour → render panel.

const PANEL_ID = 'scour-overlay-root'

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim()
}

function parsePriceToMinor(raw) {
  if (!raw) return null
  const match = String(raw).match(/(\d[\d\s.,'’]*)/)
  if (!match) return null
  const cleaned = match[1].replace(/[\s'’]/g, '').replace(/[.,]+$/, '')
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  const separator = Math.max(lastDot, lastComma)
  const digitsAfter = separator >= 0 ? cleaned.length - separator - 1 : 0
  const hasDecimal =
    (lastDot >= 0 && lastComma >= 0) || digitsAfter === 1 || digitsAfter === 2
  let normalized
  if (hasDecimal) {
    normalized =
      cleaned.slice(0, separator).replace(/[.,]/g, '') +
      '.' +
      cleaned.slice(separator + 1).replace(/[.,]/g, '')
  } else {
    normalized = cleaned.replace(/[.,]/g, '')
  }
  const n = Number(normalized)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

function extractProduct() {
  const host = location.hostname.replace(/^www\./, '')
  let title = ''
  let priceRaw = ''
  let currency = 'USD'

  const ogTitle = document.querySelector('meta[property="og:title"]')?.content
  const ogPrice =
    document.querySelector('meta[property="product:price:amount"]')?.content ||
    document.querySelector('meta[property="og:price:amount"]')?.content
  const ogCurrency =
    document.querySelector('meta[property="product:price:currency"]')?.content ||
    document.querySelector('meta[property="og:price:currency"]')?.content

  if (host.includes('amazon.')) {
    title =
      textOf(document.querySelector('#productTitle')) ||
      textOf(document.querySelector('#title')) ||
      ogTitle ||
      ''
    priceRaw =
      textOf(document.querySelector('.a-price .a-offscreen')) ||
      textOf(document.querySelector('#priceblock_ourprice')) ||
      textOf(document.querySelector('#priceblock_dealprice')) ||
      ogPrice ||
      ''
  } else if (host.includes('ebay.')) {
    title =
      textOf(document.querySelector('.x-item-title__mainTitle')) ||
      textOf(document.querySelector('h1.x-item-title__mainTitle span')) ||
      textOf(document.querySelector('h1[itemprop="name"]')) ||
      ogTitle ||
      ''
    priceRaw =
      textOf(document.querySelector('[itemprop="price"]')) ||
      textOf(document.querySelector('.x-price-primary span')) ||
      document.querySelector('[itemprop="price"]')?.getAttribute('content') ||
      ogPrice ||
      ''
  } else if (host.includes('etsy.')) {
    title =
      textOf(document.querySelector('h1[data-buy-box-listing-title]')) ||
      textOf(document.querySelector('h1')) ||
      ogTitle ||
      ''
    priceRaw =
      textOf(document.querySelector('[data-buy-box-region] p.wt-text-title-03')) ||
      textOf(document.querySelector('[data-buy-box-region] .currency-value')) ||
      ogPrice ||
      ''
  } else if (host.includes('bestbuy.')) {
    title =
      textOf(document.querySelector('.sku-title h1')) ||
      textOf(document.querySelector('h1')) ||
      ogTitle ||
      ''
    priceRaw =
      textOf(document.querySelector('[data-testid="customer-price"] span')) ||
      textOf(document.querySelector('.priceView-customer-price span')) ||
      ogPrice ||
      ''
  } else if (host.includes('walmart.') || host.includes('target.')) {
    title = textOf(document.querySelector('h1')) || ogTitle || ''
    priceRaw =
      textOf(document.querySelector('[data-automation-id="product-price"]')) ||
      textOf(document.querySelector('[data-test="product-price"]')) ||
      ogPrice ||
      ''
  } else {
    title = ogTitle || textOf(document.querySelector('h1')) || document.title
    priceRaw = ogPrice || ''
  }

  if (ogCurrency) currency = ogCurrency.trim().toUpperCase()

  title = (title || document.title || '').trim()
  // Drop noisy browser titles when we only got document.title
  if (title.length > 160) title = title.slice(0, 160)

  // Product pages usually have /dp/ or /itm/ or /listing/ etc. — skip pure search/category.
  const path = location.pathname
  const looksLikeProduct =
    /\/(dp|gp\/product|itm|listing|p|ip)\//i.test(path) ||
    /\/\d{8,}/.test(path) ||
    Boolean(document.querySelector('meta[property="og:type"][content*="product" i]')) ||
    Boolean(document.querySelector('[itemtype*="Product" i]'))

  return {
    title,
    priceMinor: parsePriceToMinor(priceRaw),
    currency,
    pageUrl: location.href,
    pageHost: host,
    looksLikeProduct,
  }
}

function ensurePanel() {
  let root = document.getElementById(PANEL_ID)
  if (root) return root
  root = document.createElement('div')
  root.id = PANEL_ID
  document.documentElement.appendChild(root)
  return root
}

function formatMoney(minor, currency) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(minor / 100)
  } catch {
    return `$${(minor / 100).toFixed(2)}`
  }
}

function renderPanel(state) {
  const root = ensurePanel()
  root.innerHTML = ''

  const panel = document.createElement('div')
  panel.className = 'scour-panel'

  const header = document.createElement('div')
  header.className = 'scour-header'
  header.innerHTML = `<span class="scour-mark">◈</span><span class="scour-brand">Scour</span>`
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'scour-close'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '×'
  close.addEventListener('click', () => root.remove())
  header.appendChild(close)
  panel.appendChild(header)

  if (state.loading) {
    const body = document.createElement('div')
    body.className = 'scour-body'
    body.innerHTML = `<div class="scour-status">Comparing across stores…</div>`
    panel.appendChild(body)
  } else if (state.error) {
    const body = document.createElement('div')
    body.className = 'scour-body'
    body.innerHTML = `<div class="scour-error">${escapeHtml(state.error)}</div>
      <div class="scour-hint">Open the Scour extension icon → set your Scour URL (default http://localhost:3000).</div>`
    panel.appendChild(body)
  } else if (state.data) {
    const d = state.data
    const body = document.createElement('div')
    body.className = 'scour-body'

    const headline = document.createElement('div')
    headline.className = 'scour-headline'
    headline.textContent = d.headline || 'Compared across stores'
    body.appendChild(headline)

    if (d.current?.priceMinor != null) {
      const cur = document.createElement('div')
      cur.className = 'scour-current'
      cur.textContent = `This page: ${formatMoney(d.current.priceMinor, d.current.currency)}`
      body.appendChild(cur)
    }

    const alts = Array.isArray(d.alternatives) ? d.alternatives.slice(0, 5) : []
    if (alts.length) {
      const list = document.createElement('ul')
      list.className = 'scour-list'
      for (const a of alts) {
        const li = document.createElement('li')
        const link = document.createElement('a')
        link.href = a.url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.innerHTML = `<span class="scour-price">${escapeHtml(formatMoney(a.priceMinor, a.currency))}</span>
          <span class="scour-store">${escapeHtml(a.store)}</span>
          <span class="scour-title">${escapeHtml(truncate(a.title, 48))}</span>`
        li.appendChild(link)
        list.appendChild(li)
      }
      body.appendChild(list)
    } else {
      const empty = document.createElement('div')
      empty.className = 'scour-hint'
      empty.textContent = 'No other storefront matches yet. Try the full search.'
      body.appendChild(empty)
    }

    const footer = document.createElement('div')
    footer.className = 'scour-footer'
    const open = document.createElement('a')
    open.href = d.scourUrl || state.baseUrl || '#'
    open.target = '_blank'
    open.rel = 'noopener noreferrer'
    open.className = 'scour-cta'
    open.textContent = 'Open in Scour →'
    footer.appendChild(open)
    const meta = document.createElement('span')
    meta.className = 'scour-meta'
    meta.textContent = `${d.storesHit ?? 0}/${d.storesSearched ?? 0} stores hit`
    footer.appendChild(meta)
    body.appendChild(footer)

    panel.appendChild(body)
  }

  root.appendChild(panel)
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(s, n) {
  const t = String(s)
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

function isProductPage(product) {
  if (!product.title || product.title.length < 4) return false
  return product.looksLikeProduct
}

async function runLookup() {
  const product = extractProduct()
  if (!isProductPage(product)) return

  renderPanel({ loading: true })

  let response
  try {
    response = await chrome.runtime.sendMessage({
      type: 'scour-lookup',
      payload: {
        title: product.title,
        priceMinor: product.priceMinor,
        currency: product.currency,
        pageUrl: product.pageUrl,
        pageHost: product.pageHost,
      },
    })
  } catch (err) {
    renderPanel({
      error: err instanceof Error ? err.message : 'Extension messaging failed.',
    })
    return
  }

  if (!response?.ok) {
    renderPanel({ error: response?.error || 'Lookup failed.' })
    return
  }

  renderPanel({ data: response.data, baseUrl: response.baseUrl })
}

// Debounce SPA navigations (Amazon soft-nav)
let timer = null
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    void runLookup()
  }, 600)
}

schedule()

// Re-run when the URL changes without a full reload
let lastHref = location.href
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href
    const existing = document.getElementById(PANEL_ID)
    if (existing) existing.remove()
    schedule()
  }
}, 1000)
