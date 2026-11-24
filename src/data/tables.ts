export interface TrajectoryPoint {
  readonly category: number
  readonly time: number
  readonly estimate: number | null
  readonly lower: number | null
  readonly upper: number | null
  readonly numericStatus: string
  readonly contrastStatus: number | null
}

export function hasUsableEstimate(point: TrajectoryPoint): boolean {
  if (point.estimate === null) return false
  return (
    (point.numericStatus === 'COMPUTED' && point.contrastStatus === 0) ||
    (point.numericStatus === 'BASELINE_ZERO' &&
      point.contrastStatus === 2 &&
      point.estimate === 0) ||
    (point.numericStatus === 'MOMENT_PRECISION_UNRESOLVED' && point.contrastStatus === 4)
  )
}

export function hasUsableBand(point: TrajectoryPoint): boolean {
  if (point.estimate === null || point.lower === null || point.upper === null) return false
  if (point.numericStatus === 'BASELINE_ZERO') {
    return (
      point.contrastStatus === 2 && point.estimate === 0 && point.lower === 0 && point.upper === 0
    )
  }
  return point.contrastStatus === 0 && point.numericStatus === 'COMPUTED'
}

/** Split at missing cells, category boundaries and gaps in the integer-minute grid. */
export function trajectorySegments(
  points: readonly TrajectoryPoint[],
  part: 'estimate' | 'band' = 'estimate',
): readonly (readonly TrajectoryPoint[])[] {
  const segments: TrajectoryPoint[][] = []
  let current: TrajectoryPoint[] = []
  let previous: TrajectoryPoint | undefined
  for (const point of points) {
    const usable = hasUsableEstimate(point) && (part === 'estimate' || hasUsableBand(point))
    const adjacent =
      previous !== undefined &&
      previous.category === point.category &&
      point.time === previous.time + 1
    if (!usable || !adjacent) {
      if (current.length > 0) segments.push(current)
      current = []
    }
    if (usable) current.push(point)
    previous = point
  }
  if (current.length > 0) segments.push(current)
  return Object.freeze(segments.map((segment) => Object.freeze(segment)))
}
