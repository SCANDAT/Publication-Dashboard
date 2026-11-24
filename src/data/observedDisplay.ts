import { OUTCOMES } from './release'
import { LOESS_FIT_STATUSES, type LoessFitStatus, type LoessScale } from './loess'

export interface ObservedCurve {
  fitStatus: LoessFitStatus
  rows: readonly (readonly [
    minute: number,
    estimate: number | null,
    pointStatus: string,
    supportStatus: string,
  ])[]
}
export const OBSERVED_SPANS = Array.from({ length: 81 }, (_, i) => i + 10)
export const OBSERVED_DISPLAY_SCHEMA = 'transfusion-dashboard/observed-fitted-v2'
const missingReasons = [
  'OUTSIDE_RETAINED_SUPPORT',
  'FIT_UNAVAILABLE',
  'NATIVE_TRANSFORM_UNAVAILABLE',
  'UNAVAILABLE_NO_INPUT',
  'UNAVAILABLE_ZERO_OR_UNDEFINED_SCALE',
  'INSUFFICIENT_SUPPORT',
] as const

type MissingReason = (typeof missingReasons)[number]
type Gap = [first: number, end: number, reason: MissingReason]

function requireDisplay(ok: unknown): asserts ok {
  if (!ok) throw new Error('Invalid observed-curve display data')
}
function isMissingReason(value: unknown): value is MissingReason {
  return missingReasons.some((reason) => reason === value)
}
function supportStatus(fit: LoessFitStatus, point: string): string {
  if (fit === 'DIRECT_COMPLETED')
    return point === 'OUTSIDE_RETAINED_SUPPORT' ? point : 'WITHIN_RETAINED_RANGE'
  return fit === 'INSUFFICIENT_SUPPORT' ? 'INSUFFICIENT_FITTING_SUPPORT' : 'NO_RETAINED_INPUT'
}

function displayValue(value: number, scale: LoessScale): number {
  const digits = scale === 'native' ? 2 : 3
  return Number(value.toFixed(digits)) || 0
}

function decodeCurve(value: unknown, scale: LoessScale): ObservedCurve {
  requireDisplay(Array.isArray(value) && value.length === 3)
  const [fit, estimates, gaps] = value as unknown[]
  requireDisplay(LOESS_FIT_STATUSES.some((label) => label === fit))
  const fitStatus = fit as LoessFitStatus
  requireDisplay(Array.isArray(estimates) && estimates.length === 1441)
  requireDisplay(Array.isArray(gaps) && gaps.length <= estimates.length)
  const checked: Gap[] = []
  for (const entry of gaps) {
    requireDisplay(Array.isArray(entry) && entry.length === 3)
    const [first, end, reason] = entry as unknown[]
    requireDisplay(typeof first === 'number' && Number.isInteger(first) && first >= 0)
    requireDisplay(
      typeof end === 'number' && Number.isInteger(end) && end > first && end <= estimates.length,
    )
    requireDisplay(isMissingReason(reason))
    const previous = checked[checked.length - 1]
    requireDisplay(
      !previous || previous[1] < first || (previous[1] === first && previous[2] !== reason),
    )
    requireDisplay(
      fitStatus === 'DIRECT_COMPLETED'
        ? reason === 'OUTSIDE_RETAINED_SUPPORT' ||
            reason === 'FIT_UNAVAILABLE' ||
            reason === 'NATIVE_TRANSFORM_UNAVAILABLE'
        : reason === fitStatus,
    )
    requireDisplay(reason !== 'NATIVE_TRANSFORM_UNAVAILABLE' || scale === 'native')
    checked.push([first, end, reason])
  }
  let run = 0
  const rows: ObservedCurve['rows'] = Array.from(estimates, (estimate: unknown, index) => {
    if (checked[run]?.[1] === index) run++
    const gap = checked[run]
    const point = gap && index >= gap[0] ? gap[2] : 'FITTED'
    requireDisplay(
      point === 'FITTED'
        ? fitStatus === 'DIRECT_COMPLETED' &&
            typeof estimate === 'number' &&
            Number.isFinite(estimate) &&
            estimate === displayValue(estimate, scale)
        : estimate === null,
    )
    return [index - 720, estimate as number | null, point, supportStatus(fitStatus, point)] as const
  })
  return { fitStatus, rows }
}

export function validateObservedDisplay(
  key: string,
  value: unknown,
): ReadonlyMap<number, ObservedCurve> {
  const parts = key.split('/')
  const scale = parts[2]
  requireDisplay(
    parts.length === 3 &&
      parts[0] === 'observed' &&
      OUTCOMES.some((outcome) => outcome === parts[1]) &&
      (scale === 'native' || scale === 'standardized'),
  )
  requireDisplay(value && typeof value === 'object' && !Array.isArray(value))
  const data = value as Record<string, unknown>
  requireDisplay(Object.keys(data).length === 2 && data.schemaVersion === OBSERVED_DISPLAY_SCHEMA)
  const curves = data.curves
  requireDisplay(Array.isArray(curves) && curves.length === OBSERVED_SPANS.length)
  return new Map(OBSERVED_SPANS.map((span, index) => [span, decodeCurve(curves[index], scale)]))
}
