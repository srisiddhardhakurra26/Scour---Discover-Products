function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length <= maxCharsPerLine) {
      cur = candidate
    } else {
      if (cur) lines.push(cur)
      cur = w
      if (lines.length >= maxLines - 1) break
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  // If we ran out and still have words left, ellipsize the last line
  const usedWords = lines.join(' ').split(/\s+/).length
  if (usedWords < words.length && lines.length > 0) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = last.length > maxCharsPerLine - 1 ? `${last.slice(0, maxCharsPerLine - 1)}…` : `${last}…`
  }
  return lines
}

export function GET(request: Request) {
  const url = new URL(request.url)
  const raw = (url.searchParams.get('text') ?? 'Product').slice(0, 120)
  const text = raw.split(/[,(]/, 1)[0].trim()
  const lines = wrapLines(text, 16, 3)

  const lineHeight = 34
  const startY = 200 - ((lines.length - 1) * lineHeight) / 2

  const tspans = lines
    .map((line, i) => `<tspan x="200" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1a1d"/>
      <stop offset="100%" stop-color="#0f0f11"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#27272a" stroke-width="0.5" opacity="0.4"/>
    </pattern>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <rect width="400" height="400" fill="url(#grid)"/>
  <circle cx="200" cy="58" r="5" fill="#fbbf24" opacity="0.6"/>
  <circle cx="200" cy="58" r="18" fill="none" stroke="#fbbf24" stroke-width="0.8" opacity="0.2"/>
  <circle cx="200" cy="58" r="32" fill="none" stroke="#fbbf24" stroke-width="0.6" opacity="0.12"/>
  <text font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto" font-size="26" font-weight="700" fill="#f4f4f5" text-anchor="middle">
    ${tspans}
  </text>
  <text x="200" y="368" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700" fill="#fbbf24" text-anchor="middle" letter-spacing="4">MOCK CATALOG</text>
</svg>`

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
