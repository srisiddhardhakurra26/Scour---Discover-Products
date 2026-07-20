// Canary health check for agent-onboarded (generic-html) sources. Runs a few
// known queries against each enabled source and — without waiting for a user to
// hit a broken store — repairs stale selectors, flags bot-blocks, and surfaces
// genuinely empty sources. Wire to cron (e.g. hourly).
//
// Run with:  npm run canary                 (repairs + flags in place)
//            npm run canary -- --dry-run     (report only, no DB writes)

import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'

// Load .env.local manually since dotenv/config reads .env by default.
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const ICON: Record<string, string> = {
  ok: '✓',
  stale: '⟳',
  repaired: '🔧',
  'repair-failed': '✗',
  blocked: '🚫',
  empty: '∅',
  unreachable: '!',
  'config-error': '⚠',
}

async function main() {
  // Import after env is loaded so the LLM client sees GROQ_API_KEY / GEMINI_API_KEY.
  const { runCanary } = await import('../src/lib/health')
  const dryRun = process.argv.includes('--dry-run')

  console.log(`Running source canary${dryRun ? ' (dry run — no writes)' : ''}…\n`)
  const reports = await runCanary({ dryRun })

  if (reports.length === 0) {
    console.log('No enabled agent-onboarded (generic-html) sources to check.')
    process.exit(0)
  }

  for (const r of reports) {
    const tag = ICON[r.status] ?? '?'
    const extra = r.status === 'ok' ? `${r.count} listings ("${r.query}")` : r.detail ?? r.status
    console.log(`  ${tag}  ${r.domain.padEnd(28)} ${r.status.padEnd(14)} ${extra}`)
  }

  const repaired = reports.filter((r) => r.status === 'repaired').length
  const needsAttention = reports.filter((r) =>
    ['stale', 'repair-failed', 'blocked', 'empty', 'unreachable', 'config-error'].includes(
      r.status,
    ),
  ).length

  console.log(
    `\nDone: ${reports.length} checked, ${repaired} repaired, ${needsAttention} need attention.`,
  )
  // Explicit exit: a JS-rendered probe leaves Chromium running, which would
  // otherwise keep the process alive.
  process.exit(needsAttention > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
