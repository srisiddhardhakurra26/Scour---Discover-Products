export function envFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? '')
}

export function envMillis(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? Math.round(parsed)
    : fallback
}
