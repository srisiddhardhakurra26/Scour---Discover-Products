/**
 * Race a promise against a hard wall-clock timeout.
 *
 * The adapter fan-out hands each adapter an AbortSignal, but not every network
 * path honors abort — e.g. an RSS/library call can hang indefinitely. Because
 * the search page streams and every Suspense boundary waits on the fan-out's
 * Promise.all, a single dead adapter stalls the entire page. This guarantees
 * the call settles: the underlying promise keeps running but is ignored once it
 * loses the race, and we reject on timeout so the caller's existing try/catch
 * treats it as a dead adapter.
 */
export function withHardTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms hard timeout`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}
