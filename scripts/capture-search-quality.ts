import { writeFile } from 'node:fs/promises'
import { getAdapters, ADAPTER_TIMEOUT_MS } from '../src/lib/adapters/registry'
import {
  validateSearchBenchmark,
  type SearchBenchmark,
  type SearchBenchmarkCase,
  type SearchEvaluationItem,
  type SearchEvaluationRun,
} from '../src/lib/search-evaluation'
import { searchProducts } from '../src/lib/search-engine'
import { buildSearchSpec } from '../src/lib/search-spec'
import { classifySearchIntent } from '../src/lib/llm/search-intent'
import { runMission, type MissionPick } from '../src/lib/mission'
import { resetSourceReliability } from '../src/lib/source-reliability'
import benchmarkDocument from '../benchmarks/search-quality.v1.json'

const NON_SHOP_TYPES = new Set(['reddit', 'rss', 'mock'])

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function slotFor(caseDefinition: SearchBenchmarkCase, ...values: string[]): string | undefined {
  const normalizedValue = normalized(values.join(' '))
  const haystack = ` ${normalizedValue} `
  const matches = caseDefinition.mission?.requiredSlots.flatMap((slot) =>
    slot.anyPhrases.flatMap((phrase) => {
      const needle = normalized(phrase)
      const index = haystack.indexOf(` ${needle} `)
      return index < 0
        ? []
        : [{ slotId: slot.id, words: needle.split(' ').length, index }]
    }),
  ) ?? []
  // Prefer the most specific phrase. A later noun breaks ties, so "dress
  // pants" maps to the pants slot instead of the generic main="dress" slot.
  return matches.sort((left, right) => right.words - left.words || right.index - left.index)[0]?.slotId
}

function resultId(pick: MissionPick): string {
  return `${pick.store}:${pick.url}`
}

async function captureProduct(
  caseDefinition: SearchBenchmarkCase,
): Promise<SearchEvaluationRun> {
  const adapters = (await getAdapters()).filter((adapter) => !NON_SHOP_TYPES.has(adapter.type))
  const spec = buildSearchSpec(caseDefinition.query)
  const intent = spec.kind === 'list' || spec.kind === 'mission'
    ? 'mission'
    : (await classifySearchIntent(caseDefinition.query)).intent
  const result = await searchProducts({
    query: caseDefinition.query,
    adapters,
    timeoutMs: ADAPTER_TIMEOUT_MS,
    persist: false,
    telemetry: false,
    maxResults: 30,
  })
  return {
    caseId: caseDefinition.id,
    predictedIntent: intent,
    results: result.products.map((product) => ({
      resultId: product.candidate.id,
      entityId: product.entityKey,
      title: product.candidate.listing.title,
      source: product.candidate.adapter.label,
      priceMinor: product.candidate.listing.priceMinor,
      currency: product.candidate.listing.currency,
      evidence: product.candidate.listing.detailsText,
    })),
  }
}

async function captureMission(
  caseDefinition: SearchBenchmarkCase,
): Promise<SearchEvaluationRun> {
  const mission = await runMission(caseDefinition.query)
  const byId = new Map<string, SearchEvaluationItem>()
  for (const slot of mission.slots) {
    for (const pick of slot.picks) {
      byId.set(resultId(pick), {
        resultId: resultId(pick),
        title: pick.title,
        source: pick.store,
        priceMinor: pick.priceMinor,
        currency: pick.currency,
        slotId:
          slotFor(caseDefinition, slot.query.q) ??
          slotFor(caseDefinition, pick.title),
      })
    }
  }
  for (const pick of mission.picks) {
    if (byId.has(resultId(pick))) continue
    byId.set(resultId(pick), {
      resultId: resultId(pick),
      title: pick.title,
      source: pick.store,
      priceMinor: pick.priceMinor,
      currency: pick.currency,
      slotId:
        slotFor(caseDefinition, pick.query) ??
        slotFor(caseDefinition, pick.title),
    })
  }

  return {
    caseId: caseDefinition.id,
    predictedIntent: 'mission',
    results: [...byId.values()],
    bundles: mission.bundles.map((bundle) => ({
      id: bundle.id,
      items: bundle.items.flatMap((pick) => {
        const slotId =
          slotFor(caseDefinition, pick.query) ??
          slotFor(caseDefinition, pick.title)
        return slotId ? [{ resultId: resultId(pick), slotId }] : []
      }),
    })),
  }
}

async function main() {
  const benchmark = benchmarkDocument as SearchBenchmark
  validateSearchBenchmark(benchmark)
  const args = process.argv.slice(2)
  const selectedIds = new Set(
    (optionValue(args, '--case') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const repeat = Math.max(1, Math.min(10, Number(optionValue(args, '--repeat') ?? 1)))
  const cases = selectedIds.size > 0
    ? benchmark.cases.filter((entry) => selectedIds.has(entry.id))
    : benchmark.cases
  if (cases.length === 0) throw new Error('No benchmark cases matched --case.')

  const runs: SearchEvaluationRun[] = []
  for (let pass = 1; pass <= repeat; pass += 1) {
    for (const caseDefinition of cases) {
      resetSourceReliability()
      process.stderr.write(`[quality:capture] ${caseDefinition.id} run ${pass}/${repeat}\n`)
      const run = caseDefinition.expectedIntent === 'mission'
        ? await captureMission(caseDefinition)
        : await captureProduct(caseDefinition)
      runs.push({ ...run, runId: `${caseDefinition.id}-${pass}` })
    }
  }

  const output = `${JSON.stringify({ benchmarkVersion: benchmark.version, runs }, null, 2)}\n`
  const outputPath = optionValue(args, '--output')
  if (outputPath) await writeFile(outputPath, output, 'utf8')
  else process.stdout.write(output)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
