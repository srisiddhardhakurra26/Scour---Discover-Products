const FAILURE_THRESHOLD = 3
const OPEN_MS = 5 * 60 * 1000

export type SourceReliability = {
  attempts: number
  successes: number
  consecutiveFailures: number
  averageLatencyMs: number
  openUntil: number
}

const globalState = globalThis as unknown as {
  __scourSourceReliability?: Map<string, SourceReliability>
}

function stateMap(): Map<string, SourceReliability> {
  if (!globalState.__scourSourceReliability) {
    globalState.__scourSourceReliability = new Map()
  }
  return globalState.__scourSourceReliability
}

function current(sourceId: string): SourceReliability {
  return (
    stateMap().get(sourceId) ?? {
      attempts: 0,
      successes: 0,
      consecutiveFailures: 0,
      averageLatencyMs: 0,
      openUntil: 0,
    }
  )
}

/** Avoid repeatedly waiting on a source that is demonstrably unavailable. */
export function sourceCanAttempt(sourceId: string, now = Date.now()): boolean {
  return current(sourceId).openUntil <= now
}

export function recordSourceSuccess(sourceId: string, latencyMs: number): void {
  const previous = current(sourceId)
  stateMap().set(sourceId, {
    attempts: previous.attempts + 1,
    successes: previous.successes + 1,
    consecutiveFailures: 0,
    averageLatencyMs:
      previous.attempts === 0
        ? latencyMs
        : Math.round(previous.averageLatencyMs * 0.8 + latencyMs * 0.2),
    openUntil: 0,
  })
}

export function recordSourceFailure(sourceId: string, latencyMs: number, now = Date.now()): void {
  const previous = current(sourceId)
  const consecutiveFailures = previous.consecutiveFailures + 1
  stateMap().set(sourceId, {
    attempts: previous.attempts + 1,
    successes: previous.successes,
    consecutiveFailures,
    averageLatencyMs:
      previous.attempts === 0
        ? latencyMs
        : Math.round(previous.averageLatencyMs * 0.8 + latencyMs * 0.2),
    openUntil: consecutiveFailures >= FAILURE_THRESHOLD ? now + OPEN_MS : previous.openUntil,
  })
}

export function sourceReliabilitySnapshot(sourceId: string): SourceReliability {
  return { ...current(sourceId) }
}

export function resetSourceReliability(): void {
  stateMap().clear()
}
