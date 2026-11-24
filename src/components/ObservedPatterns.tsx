import { useEffect, useId, useMemo, useState } from 'react'
import { OUTCOMES } from '../data/release'
import {
  OUTCOME_META,
  POPULATION_LABELS,
  timeWindowLabel,
  outcomeAddress,
  readSelection,
} from '../data/display'
import { readDisplay, isResultUnavailable } from '../data/reader'
import {
  OBSERVED_SPANS,
  validateObservedDisplay,
  type ObservedCurve,
} from '../data/observedDisplay'
import { loessStatusLabel, type LoessOutcome, type LoessScale } from '../data/loess'
import LoessChart from './LoessChart'
import OptionsPanel from './OptionsPanel'
import './observedPatterns.css'

interface Props {
  releaseError: boolean
  displayReleaseId?: string
}
export default function ObservedPatterns({ releaseError, displayReleaseId }: Props) {
  const spanId = useId()
  const [outcome, setOutcome] = useState<LoessOutcome>(() => {
    return (
      readSelection(new URLSearchParams(location.search), 'outcome', OUTCOMES, outcomeAddress) ??
      'ARTm'
    )
  })
  const [scale, setScale] = useState<LoessScale>(() =>
    new URLSearchParams(location.search).get('scale') === 'standardized'
      ? 'standardized'
      : 'native',
  )
  const [spanPercent, setSpanPercent] = useState(() => {
    const value = Number(new URLSearchParams(location.search).get('span'))
    return OBSERVED_SPANS.find((percent) => value === percent / 100 || value === percent) ?? 30
  })
  const [windowMinutes, setWindowMinutes] = useState(() => {
    const value = Number(new URLSearchParams(location.search).get('minutes'))
    return [60, 360, 720].find((minutes) => minutes === value) ?? 720
  })
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('outcome', outcomeAddress(outcome))
    url.searchParams.set('scale', scale)
    url.searchParams.set('minutes', String(windowMinutes))
    url.searchParams.set('span', (spanPercent / 100).toFixed(2))
    history.replaceState(null, '', url)
  }, [outcome, scale, windowMinutes, spanPercent])
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    key: string
    state: 'loading' | 'ready' | 'error' | 'unavailable'
    value?: ReadonlyMap<number, ObservedCurve>
  }>({ key: '', state: 'loading' })
  const spans = OBSERVED_SPANS
  const spanIndex = spans.indexOf(spanPercent)
  const selection = JSON.stringify([displayReleaseId, outcome, scale])
  const curves = result.key === selection && result.state === 'ready' ? result.value : undefined
  const series = curves?.get(spanPercent)
  const domain = useMemo(() => {
    if (!curves) return undefined
    let min = Infinity,
      max = -Infinity
    for (const curve of curves.values())
      for (const row of curve.rows)
        if (row[1] !== null) {
          min = Math.min(min, row[1])
          max = Math.max(max, row[1])
        }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
    const padding = Math.max((max - min) * 0.12, Math.max(Math.abs(min), Math.abs(max), 1) * 0.001)
    return { min: min - padding, max: max + padding }
  }, [curves])
  const points = useMemo(
    () =>
      series
        ? series.rows.map(([time, estimate, pointStatus, supportStatus]) => ({
            time,
            estimate,
            pointStatus,
            supportStatus,
          }))
        : [],
    [series],
  )
  const meta = OUTCOME_META[outcome]
  const unit = scale === 'native' ? meta.unit : 'SD units'
  const curveDescription =
    'The curve smooths the mean readings at selected times in the primary cohort. Each time has equal weight, and different events can contribute at different times. Table 2 averages the change within each event with readings in both windows, giving each event equal weight. The two summaries can move in different directions.'
  useEffect(() => {
    if (!displayReleaseId) return
    const controller = new AbortController()
    const key = `observed/${outcome}/${scale}`
    setResult({ key: selection, state: 'loading' })
    readDisplay(key, controller.signal)
      .then((raw) => validateObservedDisplay(key, raw))
      .then((value) => {
        if (!controller.signal.aborted) setResult({ key: selection, state: 'ready', value })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key: selection,
            state: isResultUnavailable(reason) ? 'unavailable' : 'error',
          })
      })
    return () => controller.abort()
  }, [displayReleaseId, outcome, scale, selection, retry])
  const error = releaseError || (result.key === selection && result.state === 'error')
  const scaleToggle = (
    <div className="segmented loess-scale-toggle" role="group" aria-label="Scale">
      <button type="button" aria-pressed={scale === 'native'} onClick={() => setScale('native')}>
        Recorded units
      </button>
      <button
        type="button"
        aria-pressed={scale === 'standardized'}
        onClick={() => setScale('standardized')}
      >
        Standardized (SD)
      </button>
    </div>
  )
  const unavailable = result.key === selection && result.state === 'unavailable'
  return (
    <section className="observed-patterns" aria-labelledby="observed-title">
      <div className="view-heading">
        <div>
          <h2 id="observed-title">Observed patterns</h2>
          <p>Unadjusted LOESS curves &middot; {POPULATION_LABELS.PRIMARY}</p>
        </div>
      </div>
      <div className="controls loess-controls primary-controls">
        <label>
          Outcome
          <select
            aria-label="Outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as LoessOutcome)}
          >
            {OUTCOMES.map((code) => (
              <option key={code} value={code}>
                {OUTCOME_META[code].name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Time window
          <select
            aria-label="Time window"
            value={windowMinutes}
            onChange={(event) => setWindowMinutes(Number(event.target.value))}
          >
            {[60, 360, 720].map((value) => (
              <option key={value} value={value}>
                &plusmn;{timeWindowLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <OptionsPanel
        className="loess-smoothing-options"
        label="Smoothing options"
        summary={`Smoothing span ${(spanPercent / 100).toFixed(2)}`}
      >
        <div className="controls loess-smoothing-controls">
          <label className="loess-span-control" htmlFor={spanId}>
            <span className="loess-span-heading">
              Smoothing span<output htmlFor={spanId}>{(spanPercent / 100).toFixed(2)}</output>
            </span>
            <input
              id={spanId}
              type="range"
              aria-label="Smoothing span"
              aria-valuetext={(spanPercent / 100).toFixed(2)}
              aria-describedby={`${spanId}-help`}
              min={0}
              max={Math.max(0, spans.length - 1)}
              step={1}
              value={Math.max(0, spanIndex)}
              disabled={!curves || spans.length < 2 || spanIndex < 0}
              onChange={(event) => {
                const value = spans[Number(event.target.value)]
                if (value !== undefined) setSpanPercent(value)
              }}
            />
            <span className="loess-span-limits" aria-hidden="true">
              <span>{spans.length ? (spans[0]! / 100).toFixed(2) : '\u2014'}</span>
              <span>{spans.length ? (spans[spans.length - 1]! / 100).toFixed(2) : '\u2014'}</span>
            </span>
          </label>
        </div>
      </OptionsPanel>
      <p className="report-note" id={`${spanId}-help`}>
        Larger spans give smoother curves. Changing the time window changes only the range shown.
      </p>
      <p className="report-note">
        {curveDescription} The curve is unadjusted and has no confidence band.
      </p>
      {(unavailable || error) && <div className="loess-heading-actions">{scaleToggle}</div>}
      {error ? (
        <div className="error" role="alert">
          <h3>Descriptive results could not be loaded</h3>
          <button onClick={() => setRetry((value) => value + 1)}>Try again</button>
        </div>
      ) : unavailable ? (
        <div className="report-empty" role="status">
          The selected descriptive curves are unavailable.
        </div>
      ) : (
        <section className="trajectory-card loess-card" aria-labelledby="loess-outcome-title">
          <div className="card-title">
            <div>
              <h3 id="loess-outcome-title">{meta.name}</h3>
              <p>
                {scale === 'native'
                  ? meta.unit
                  : 'Standard deviations from the mean of the eligible measurement records'}
              </p>
            </div>
            <div className="loess-heading-actions">
              {scaleToggle}
              <span className="outcome-code">Span {(spanPercent / 100).toFixed(2)}</span>
            </div>
          </div>
          {series ? (
            <LoessChart
              points={points}
              title={meta.name}
              unit={unit}
              digits={scale === 'native' ? 2 : 3}
              color={meta.color}
              windowMinutes={windowMinutes}
              domain={domain}
              context={`${curveDescription} Unadjusted LOESS; ${POPULATION_LABELS.PRIMARY}; ${scale === 'native' ? 'recorded clinical scale' : 'standardized scale'}; span ${(spanPercent / 100).toFixed(2)}; ${timeWindowLabel(windowMinutes)} before and after transfusion start`}
            />
          ) : (
            <div className="loess-loading-chart" aria-busy="true">
              <div className="loess-loading-frame" role="status">
                Loading fitted curves...
              </div>
            </div>
          )}
          <div className="loess-support" role="status">
            {series && series.fitStatus !== 'DIRECT_COMPLETED'
              ? loessStatusLabel(series.fitStatus)
              : '\u00a0'}
          </div>
        </section>
      )}
      <details className="method-note">
        <summary>Smoothing, scales and available values</summary>
        <p>
          The curves include available readings in the primary cohort even when treatment or other
          model covariates were missing. When a reading was recorded for each of several units
          started together, each entry contributed to its time-point mean.
        </p>
        <p>
          Within each outcome, readings were pooled and averaged at each exact time relative to
          transfusion start. When the total across outcomes exceeded 50,000 time groups, groups were
          sampled using a fixed random seed with probability 50,000 divided by the total. Every
          third remaining group in time order within each outcome was retained and given equal
          weight in the local quadratic fit. We interpolated linearly between adjacent fitted values
          at one-minute intervals within the fitted range. The time-window control changes the
          displayed interval.
        </p>
        <p>
          The standardized scale shows standard deviations from each outcome&rsquo;s mean,
          calculated from eligible measurements before restriction to the &plusmn;12-hour interval.
          The recorded scale shows the same fitted curve in clinical units.
        </p>
        <p>
          For the observed change in Table 2, we first averaged each event’s readings 55–65 minutes
          before and 55–65 minutes after transfusion. We then averaged the paired differences (after
          minus before) across events with readings in both windows.
        </p>
      </details>
    </section>
  )
}
