// Next.js instrumentation hook — runs once at server start, compiled for BOTH
// the Node and Edge runtimes. All node-only work (prisma/sqlite, the embedding
// model) lives in instrumentation-node.ts behind this runtime check, so the
// Edge compile never traverses those imports and doesn't spam "not supported
// in the Edge Runtime" warnings on every build.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { warmup } = await import('./instrumentation-node')
    warmup()
  }
}
