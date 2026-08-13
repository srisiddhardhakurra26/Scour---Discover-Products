import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  evaluateSearchBenchmark,
  validateSearchBenchmark,
  type SearchEvaluationRun,
} from '../src/lib/search-evaluation'

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function validateRuns(value: unknown): asserts value is SearchEvaluationRun[] {
  if (!Array.isArray(value)) throw new Error('Predictions must contain a runs array')
  for (const run of value) {
    if (!run || typeof run !== 'object') throw new Error('Every run must be an object')
    const candidate = run as Partial<SearchEvaluationRun>
    if (
      typeof candidate.caseId !== 'string' ||
      !['product', 'mission'].includes(candidate.predictedIntent ?? '') ||
      !Array.isArray(candidate.results)
    ) {
      throw new Error('Every run requires caseId, predictedIntent, and results')
    }
  }
}

async function loadJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}

async function main() {
  const args = process.argv.slice(2)
  const predictionsArg = args.find((arg) => !arg.startsWith('--'))
  if (!predictionsArg) {
    throw new Error(
      'Usage: tsx scripts/evaluate-search.ts <predictions.json> [--benchmark=path] [--strict]',
    )
  }

  const predictionsPath = path.resolve(predictionsArg)
  const benchmarkPath = path.resolve(
    optionValue(args, '--benchmark') ?? 'benchmarks/search-quality.v1.json',
  )
  const benchmark = await loadJson(benchmarkPath)
  validateSearchBenchmark(benchmark)

  const predictionDocument = await loadJson(predictionsPath)
  const runs = Array.isArray(predictionDocument)
    ? predictionDocument
    : (predictionDocument as { runs?: unknown } | null)?.runs
  validateRuns(runs)

  const report = evaluateSearchBenchmark(benchmark, runs)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (
    args.includes('--strict') &&
    (report.missingCaseIds.length > 0 || report.unknownCaseIds.length > 0)
  ) {
    process.exitCode = 2
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
