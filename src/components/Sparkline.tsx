export function Sparkline({
  values,
  width = 80,
  height = 22,
  strokeWidth = 1.5,
}: {
  values: number[]
  width?: number
  height?: number
  strokeWidth?: number
}) {
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const padY = 2

  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1
  const y = (v: number) =>
    range === 0
      ? height / 2
      : height - padY - ((v - min) / range) * (height - padY * 2)

  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(' ')

  const last = values[values.length - 1]
  const first = values[0]
  const trendDown = last < first
  const trendUp = last > first
  const color = trendDown
    ? 'var(--color-success)'
    : trendUp
      ? 'var(--color-danger)'
      : 'var(--color-fg-subtle)'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="overflow-visible"
    >
      <path d={path} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2" fill={color} />
    </svg>
  )
}
