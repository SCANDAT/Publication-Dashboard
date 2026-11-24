import { hasUsableBand, type TrajectoryPoint } from '../data/tables'
export interface CurveDomain {
  min: number
  max: number
}
export function curveDomain(points: readonly TrajectoryPoint[], zero: boolean): CurveDomain | null {
  const values = points
    .flatMap((p) => [p.estimate, ...(hasUsableBand(p) ? [p.lower, p.upper] : [])])
    .filter((v): v is number => v !== null && Number.isFinite(v))
  if (!values.length) return null
  if (zero) values.push(0)
  const min = Math.min(...values),
    max = Math.max(...values)
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.0001, 0.001)
  return { min: min - pad, max: max + pad }
}
/** Grid positions are exact multiples of a human-readable step within the displayed domain. */
export function axisTicks({ min, max }: CurveDomain): number[] {
  const targetStep = (max - min) / 4
  const magnitude = 10 ** Math.floor(Math.log10(targetStep))
  const scaled = targetStep / magnitude
  const step =
    (scaled < Math.sqrt(2) ? 1 : scaled < Math.sqrt(10) ? 2 : scaled < Math.sqrt(50) ? 5 : 10) *
    magnitude
  const ticks: number[] = []
  for (let index = Math.ceil(min / step); index <= Math.floor(max / step); index++) {
    ticks.push(Number((index * step).toPrecision(12)))
  }
  return ticks
}

export function formatTick(value: number): string {
  return String(Number(value.toPrecision(12))).replace('-', '−')
}

export function formatValue(value: number | null, digits = 2): string {
  if (value === null) return 'Unavailable'
  const text = Math.abs(value).toFixed(digits)
  return value < 0 ? '−' + text : text
}
