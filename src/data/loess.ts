import type { OUTCOMES } from './release'

export const LOESS_SCALES = ['native', 'standardized'] as const
export const LOESS_FIT_STATUSES = [
  'DIRECT_COMPLETED',
  'UNAVAILABLE_NO_INPUT',
  'UNAVAILABLE_ZERO_OR_UNDEFINED_SCALE',
  'INSUFFICIENT_SUPPORT',
] as const
export type LoessScale = (typeof LOESS_SCALES)[number]
export type LoessOutcome = (typeof OUTCOMES)[number]
export type LoessFitStatus = (typeof LOESS_FIT_STATUSES)[number]

export interface LoessPoint {
  time: number
  estimate: number | null
  pointStatus: string
  supportStatus: string
}

/** Preserve absent predictions and support gaps; never connect across them. */
export function loessSegments(points: readonly LoessPoint[]): readonly (readonly LoessPoint[])[] {
  const segments: LoessPoint[][] = []
  let part: LoessPoint[] = []
  for (const point of points) {
    if (point.estimate === null) {
      if (part.length) segments.push(part)
      part = []
      continue
    }
    if (part.length && point.time !== part[part.length - 1]!.time + 1) {
      segments.push(part)
      part = []
    }
    part.push(point)
  }
  if (part.length) segments.push(part)
  return segments
}
export function loessStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DIRECT_COMPLETED: 'Fitted curve available',
    FITTED: 'Fitted value',
    OUTSIDE_RETAINED_SUPPORT: 'Outside the fitted time range',
    FIT_UNAVAILABLE: 'Fitted value unavailable',
    NATIVE_TRANSFORM_UNAVAILABLE: 'Original-scale transformation unavailable',
    UNAVAILABLE_NO_INPUT: 'No eligible measurements',
    UNAVAILABLE_NO_RETAINED_INPUT: 'No retained measurements',
    UNAVAILABLE_ZERO_OR_UNDEFINED_SCALE: 'Standardization unavailable',
    INSUFFICIENT_SUPPORT: 'Insufficient fitting support',
    WITHIN_RETAINED_RANGE: 'Within the fitted time range',
    NO_RETAINED_INPUT: 'No retained measurements',
    INSUFFICIENT_FITTING_SUPPORT: 'Insufficient fitting support',
  }
  return labels[status] ?? 'Result unavailable'
}
