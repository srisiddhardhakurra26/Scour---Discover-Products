import { prisma } from '@/lib/db'
import { hashSearchQuery } from '@/lib/search-telemetry'

export const runtime = 'nodejs'

const VERDICTS = new Set(['helpful', 'not_helpful'])
const REASONS = new Set([
  'off_topic',
  'wrong_product_type',
  'constraint_violation',
  'duplicate',
  'bad_price',
  'unavailable',
  'other',
])

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 500) : ''
  const verdict = typeof body.verdict === 'string' ? body.verdict : ''
  const reason = typeof body.reason === 'string' ? body.reason : undefined
  const requestedSearchRunId =
    typeof body.searchRunId === 'string' ? body.searchRunId.trim().slice(0, 100) : undefined
  const resultKey = typeof body.resultKey === 'string' ? body.resultKey.slice(0, 500) : undefined

  if (!query || !VERDICTS.has(verdict) || (reason && !REASONS.has(reason))) {
    return Response.json({ error: 'Invalid feedback.' }, { status: 400 })
  }

  try {
    const searchRunId = requestedSearchRunId
      ? (
          await prisma.searchRun.findUnique({
            where: { id: requestedSearchRunId },
            select: { id: true },
          })
        )?.id
      : undefined
    await prisma.searchFeedback.create({
      data: {
        queryHash: hashSearchQuery(query),
        verdict,
        reason,
        searchRunId,
        resultKey,
      },
    })
    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    console.warn('[search-feedback]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Could not save feedback.' }, { status: 500 })
  }
}
