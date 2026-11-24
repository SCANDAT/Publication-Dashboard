import { useId, useMemo, useState, type ReactNode } from 'react'
import ChartDialog from './ChartDialog'
import type { FitKey } from '../data/release'
import {
  MODEL_LABELS,
  POPULATION_LABELS,
  COHORT_SLUG,
  MODEL_FILENAME,
  timeWindowLabel,
  outcomeAddress,
} from '../data/display'
import { hasUsableBand, trajectorySegments, type TrajectoryPoint } from '../data/tables'
import {
  axisTicks,
  curveDomain,
  formatTick,
  formatValue,
  type CurveDomain,
} from './trajectoryGeometry'

interface Props {
  points: readonly TrajectoryPoint[]
  title: string
  unit: string
  windowMinutes: number
  color: string
  domain?: CurveDomain
  change: boolean
  footer?: ReactNode
  expandable?: boolean
  downloadContext: Pick<FitKey, 'population' | 'model' | 'outcome'>
}
export default function TrajectoryChart({
  points,
  title,
  unit,
  windowMinutes,
  color,
  domain,
  change,
  downloadContext,
  footer,
  expandable = true,
}: Props) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState<TrajectoryPoint | null>(null)
  const [keyboardActive, setKeyboardActive] = useState(false)
  const visible = useMemo(
    () => points.filter((p) => Math.abs(p.time) <= windowMinutes),
    [points, windowMinutes],
  )
  const bounds = useMemo(() => domain ?? curveDomain(visible, change), [domain, visible, change])
  const W = 440,
    H = 270,
    L = 54,
    R = 14,
    T = 18,
    B = 38
  const paths = useMemo(() => {
    if (!bounds) return { lines: [], bands: [] }
    const px = (t: number) => L + ((t + windowMinutes) / (windowMinutes * 2)) * (W - L - R)
    const py = (v: number) => T + ((bounds.max - v) / (bounds.max - bounds.min)) * (H - T - B)
    return {
      lines: trajectorySegments(visible, 'estimate').map(
        (part) => `M${part.map((p) => `${px(p.time)},${py(p.estimate!)}`).join(' L')}`,
      ),
      bands: trajectorySegments(visible, 'band').map(
        (part) =>
          `M${part.map((p) => `${px(p.time)},${py(p.upper!)}`).join(' L')} L${[...part]
            .reverse()
            .map((p) => `${px(p.time)},${py(p.lower!)}`)
            .join(' L')} Z`,
      ),
    }
  }, [bounds, visible, windowMinutes])
  if (!bounds) return <div className="chart-unavailable">No trajectory estimate is available.</div>
  const x = (t: number) => L + ((t + windowMinutes) / (windowMinutes * 2)) * (W - L - R)
  const y = (v: number) => T + ((bounds.max - v) / (bounds.max - bounds.min)) * (H - T - B)
  const selected = hover && visible.includes(hover) ? hover : null
  const xTicks = [-windowMinutes, -windowMinutes / 2, 0, windowMinutes / 2, windowMinutes]
  const oxygenChange = change && ['FIO2', 'SPO2'].includes(downloadContext.outcome)
  const unitDefinition = oxygenChange
    ? 'Absolute change in percentage points'
    : `${change ? 'Change' : 'Level'} in ${unit}`
  const context = (
    <>
      <p>
        {MODEL_LABELS[downloadContext.model]} · {POPULATION_LABELS[downloadContext.population]} ·{' '}
        {change ? 'Change from one hour before transfusion start' : 'Predicted mean level'} · {unit}
      </p>
      <p>
        ±{timeWindowLabel(windowMinutes)}. Shading: pointwise 95% confidence intervals. Dots: −1 and
        +1 hour.
      </p>
      {oxygenChange && <p>Changes are expressed in percentage points.</p>}
    </>
  )
  return (
    <div className={`chart-wrap trajectory-chart${expandable ? ' chart-expandable' : ''}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc ${id}-readout`}
        onClick={
          expandable
            ? (event) => {
                event.currentTarget.focus()
                setExpanded(true)
              }
            : undefined
        }
        onFocus={() => {
          setKeyboardActive(true)
          if (!hover)
            setHover(
              visible.reduce<TrajectoryPoint | null>(
                (a, p) => (!a || Math.abs(p.time) < Math.abs(a.time) ? p : a),
                null,
              ),
            )
        }}
        onBlur={() => {
          if (keyboardActive) setHover(null)
          setKeyboardActive(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && expandable) {
            event.preventDefault()
            setExpanded(true)
            return
          }
          if (
            !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) ||
            !visible.length
          )
            return
          event.preventDefault()
          setKeyboardActive(true)
          const index = selected
            ? visible.indexOf(selected)
            : Math.max(
                0,
                visible.findIndex((p) => p.time >= 0),
              )
          if (event.key === 'Home') setHover(visible[0]!)
          else if (event.key === 'End') setHover(visible[visible.length - 1]!)
          else if (event.key === 'PageUp' || event.key === 'PageDown') {
            const target = (selected?.time ?? 0) + (event.key === 'PageUp' ? 60 : -60)
            setHover(
              visible.reduce((a, p) =>
                Math.abs(p.time - target) < Math.abs(a.time - target) ? p : a,
              ),
            )
          } else
            setHover(
              visible[
                Math.max(
                  0,
                  Math.min(visible.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)),
                )
              ]!,
            )
        }}
        onPointerLeave={() => {
          if (!keyboardActive) setHover(null)
        }}
        onPointerMove={(event) => {
          setKeyboardActive(false)
          const rect = event.currentTarget.getBoundingClientRect()
          const px = ((event.clientX - rect.left) / rect.width) * W
          const minute = (((px - L) / (W - L - R)) * 2 - 1) * windowMinutes
          const nearest = visible.reduce<TrajectoryPoint | null>(
            (a, p) => (!a || Math.abs(p.time - minute) < Math.abs(a.time - minute) ? p : a),
            null,
          )
          setHover(nearest)
        }}
      >
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-desc`}>
          Predicted {change ? 'change from one hour before transfusion start' : 'level'} in {unit}.{' '}
          {oxygenChange && 'Changes are expressed in percentage points. '}Shading shows available
          pointwise 95% confidence intervals. The dashed vertical line is transfusion start. Dots
          mark minus and plus one hour. Gaps indicate times without a model estimate or confidence
          interval. Use left and right arrow keys to inspect exported points, Page Up and Page Down
          to move an hour, and Home or End for the window limits.
        </desc>
        {axisTicks(bounds).map((value) => (
          <g key={value}>
            <line x1={L} x2={W - R} y1={y(value)} y2={y(value)} className="grid-line" />
            <text x={L - 9} y={y(value) + 4} textAnchor="end" className="axis-text">
              {formatTick(value)}
            </text>
          </g>
        ))}
        {change && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="zero-line" />}
        <line x1={x(0)} x2={x(0)} y1={T} y2={H - B} className="event-line" />
        {paths.bands.map((path, i) => (
          <path key={`band-${i}`} d={path} fill={color} fillOpacity={0.13} />
        ))}
        {paths.lines.map((path, i) => (
          <path
            key={`line-${i}`}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={2.1}
            strokeLinejoin="round"
          />
        ))}
        {visible
          .filter((p) => Math.abs(p.time) === 60 && p.estimate !== null)
          .map((p) => (
            <circle
              key={p.time}
              cx={x(p.time)}
              cy={y(p.estimate!)}
              r={3.5}
              fill={color}
              stroke="white"
              strokeWidth={1.2}
            />
          ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - B + 19} textAnchor="middle" className="axis-text">
            {t === 0 ? '0' : `${t > 0 ? '+' : ''}${formatTick(t / 60)}`}
          </text>
        ))}
        <text x={(L + W - R) / 2} y={H - 2} textAnchor="middle" className="axis-label">
          Hours from transfusion start
        </text>
        {selected && (
          <line
            x1={x(selected.time)}
            x2={x(selected.time)}
            y1={T}
            y2={H - B}
            className="hover-line"
          />
        )}
      </svg>
      <div
        className="chart-readout"
        id={`${id}-readout`}
        aria-live={keyboardActive ? 'polite' : 'off'}
      >
        {selected ? (
          <>
            {formatValue(selected.time / 60, 2)} h:{' '}
            <strong>{formatValue(selected.estimate)}</strong> {unit}
            {hasUsableBand(selected)
              ? ` (95% CI ${formatValue(selected.lower)} to ${formatValue(selected.upper)})`
              : ' (interval unavailable)'}
          </>
        ) : (
          <span aria-hidden="true">&nbsp;</span>
        )}
      </div>
      <div className="trajectory-footer">
        <div className="chart-action-stack">
          {expandable && (
            <button
              className="chart-enlarge"
              type="button"
              aria-label={`Enlarge chart: ${title}`}
              onClick={(event) => {
                event.currentTarget.focus()
                setExpanded(true)
              }}
            >
              Enlarge chart
            </button>
          )}
          <button
            className="data-download"
            type="button"
            onClick={() => {
              const field = (value: number | null) =>
                value === null ? '' : formatValue(value).replace('−', '-')
              const metadata = [
                POPULATION_LABELS[downloadContext.population],
                MODEL_LABELS[downloadContext.model],
                title,
                unit,
                unitDefinition,
              ]
              const rows = [
                [
                  'Cohort',
                  'Model',
                  'Outcome',
                  'Unit',
                  'Quantity',
                  'Minutes from transfusion start',
                  change ? 'Predicted change from one hour before transfusion' : 'Predicted level',
                  'Lower pointwise 95% CI',
                  'Upper pointwise 95% CI',
                  'Interpretation',
                ],
                ...visible.map((p) => [
                  ...metadata,
                  String(p.time),
                  field(p.estimate),
                  field(hasUsableBand(p) ? p.lower : null),
                  field(hasUsableBand(p) ? p.upper : null),
                  p.numericStatus === 'BASELINE_ZERO'
                    ? 'Reference time (change is zero by definition)'
                    : p.estimate === null
                      ? 'Estimate unavailable'
                      : !hasUsableBand(p)
                        ? 'Interval unavailable'
                        : '',
                ]),
              ]
              const blob = new Blob(
                [
                  rows
                    .map((row) =>
                      row.map((value) => '"' + value.replace(/"/g, '""') + '"').join(','),
                    )
                    .join('\n') + '\n',
                ],
                { type: 'text/csv;charset=utf-8' },
              )
              const url = URL.createObjectURL(blob),
                link = document.createElement('a')
              link.href = url
              link.download = `${outcomeAddress(downloadContext.outcome)}-${change ? 'change' : 'level'}-${COHORT_SLUG[downloadContext.population]}-${MODEL_FILENAME[downloadContext.model]}-plus-minus-${windowMinutes / 60}h.csv`
              link.click()
              setTimeout(() => URL.revokeObjectURL(url), 0)
            }}
            title="Estimates and confidence limits are reported to two decimal places."
            aria-label={`Download plotted values for ${title}`}
          >
            Download values
          </button>
        </div>
        {footer}
      </div>

      {expandable && (
        <ChartDialog
          open={expanded}
          title={title}
          context={context}
          onClose={() => setExpanded(false)}
        >
          <TrajectoryChart
            points={points}
            title={title}
            unit={unit}
            windowMinutes={windowMinutes}
            color={color}
            domain={domain}
            change={change}
            downloadContext={downloadContext}
            footer={footer}
            expandable={false}
          />
        </ChartDialog>
      )}
    </div>
  )
}
