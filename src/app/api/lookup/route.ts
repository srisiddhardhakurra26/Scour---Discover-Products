import { lookupProduct, lookupHeadline } from '@/lib/lookup'

export const runtime = 'nodejs'

// Extension may call from content/background; allow any origin (no secrets).
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: Request) {
  let body: {
    title?: unknown
    priceMinor?: unknown
    currency?: unknown
    pageUrl?: unknown
    pageHost?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400, headers: CORS })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) {
    return Response.json({ error: 'title is required.' }, { status: 400, headers: CORS })
  }

  const priceMinor =
    typeof body.priceMinor === 'number' && Number.isFinite(body.priceMinor)
      ? Math.round(body.priceMinor)
      : null
  const currency = typeof body.currency === 'string' ? body.currency : 'USD'
  const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl : undefined
  const pageHost = typeof body.pageHost === 'string' ? body.pageHost : undefined

  // Always the Scour host — extension Origin is chrome-extension://… which
  // must never become a deep-link base.
  const origin = new URL(req.url).origin

  try {
    const result = await lookupProduct({
      title,
      priceMinor,
      currency,
      pageUrl,
      pageHost,
      baseUrl: origin,
    })
    return Response.json(
      { ...result, headline: lookupHeadline(result) },
      { headers: { ...CORS, 'content-type': 'application/json' } },
    )
  } catch (err) {
    console.error('[lookup]', err)
    return Response.json(
      { error: 'Lookup failed.' },
      { status: 500, headers: CORS },
    )
  }
}
