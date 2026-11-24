import { useEffect, useId, useState } from 'react'
import type { FitKey } from '../data/release'
import {
  COHORT_SLUG,
  MODEL_FILENAME,
  COMPONENT_FACTOR_ORDER,
  FACTOR_LABELS,
  OUTCOME_META,
  OUTCOME_HEADING_LINES,
  PANEL_ORDER,
  MODEL_LABELS,
  POPULATION_LABELS,
  PARITY_NOTE,
  categoryCaption,
} from '../data/display'
import { isResultUnavailable } from '../data/reader'
import {
  componentCategories,
  overallProbability,
  type DisplayComparison,
  type DisplayComparisonLoader,
} from '../data/componentDisplay'
import { displayPairs, type DisplayPair } from '../data/pairwiseDisplay'
import { formatTick, formatValue } from './trajectoryGeometry'
import './componentOverview.css'
import SummaryDownload from './SummaryDownload'
import { componentSummarySvg } from '../figures/summarySvg'

type Factor = Exclude<FitKey['factor'], 'MAIN'>
interface Props {
  displayReleaseId?: string
  loadDisplay: DisplayComparisonLoader
  releaseError: boolean
  model: FitKey['model']
  population: FitKey['population']
  onExplore: (key: FitKey, referenceCode: string) => void
}
interface Cell {
  result?: DisplayComparison
  message?: string
}
interface Loaded {
  scope: string
  cells: Readonly<Record<string, Cell>>
  completed: number
  total: number
}
const FACTOR_ORDER = COMPONENT_FACTOR_ORDER
const REQUEST_WORKERS = 4
const CATEGORY_ROW_HEIGHT = 20
const CATEGORY_POINT_OFFSET = 12
function cellId(factor: Factor, outcome: FitKey['outcome']) {
  return `${factor}/${outcome}`
}
function plotBound(rows: readonly DisplayPair[]): number | null {
  const values = rows
    .flatMap((row) => [row.lower, row.estimate, row.upper])
    .filter((value): value is number => value !== null && Number.isFinite(value))
  if (!values.length) return null
  const span = Math.max(...values.map(Math.abs), 0.001) * 1.08
  const step = 10 ** Math.floor(Math.log10(span))
  return Math.ceil(span / step) * step
}
function pointX(value: number, bound: number) {
  return 12 + ((value + bound) / (bound * 2)) * 104
}
function pairDescription(factor: Factor, pair: DisplayPair, unit: string): string {
  return `${categoryCaption(factor, pair.a)} versus ${categoryCaption(factor, pair.b)}: ${
    pair.estimate === null
      ? 'unavailable'
      : `${formatValue(pair.estimate)}; 95% confidence interval ${formatValue(pair.lower)} to ${formatValue(pair.upper)} ${unit}`
  }.`
}

export default function ComponentOverview({
  releaseError,
  model,
  population,
  onExplore,
  displayReleaseId,
  loadDisplay,
}: Props) {
  const id = useId()
  const scope = `${displayReleaseId}/${population}/${model}`
  const [loaded, setLoaded] = useState<Loaded>({ scope: '', cells: {}, completed: 0, total: 0 })
  const current = loaded.scope === scope ? loaded : undefined

  useEffect(() => {
    if (!displayReleaseId || releaseError) return
    const controller = new AbortController()
    const cells: Record<string, Cell> = {}
    const queue = FACTOR_ORDER.flatMap((factor) =>
      PANEL_ORDER.map((outcome) => ({
        name: cellId(factor, outcome),
        key: { population, model, factor, outcome },
      })),
    )
    let cursor = 0
    let completed = 0
    setLoaded({ scope, cells: {}, completed, total: queue.length })
    async function worker() {
      while (!controller.signal.aborted) {
        const item = queue[cursor++]
        if (!item) return
        const { name, key } = item
        try {
          const result = await loadDisplay(key, controller.signal)
          if (controller.signal.aborted) return
          cells[name] = { result }
        } catch (error) {
          if (controller.signal.aborted) return
          cells[name] = {
            message: isResultUnavailable(error)
              ? 'These comparisons are unavailable.'
              : 'These comparisons could not be loaded.',
          }
        }
        completed += 1
        if (!controller.signal.aborted)
          setLoaded({ scope, cells: {}, completed, total: queue.length })
      }
    }
    // Set the common column scales once all plots have loaded.
    Promise.all(Array.from({ length: Math.min(REQUEST_WORKERS, queue.length) }, worker)).then(
      () => {
        if (!controller.signal.aborted) setLoaded({ scope, cells, completed, total: queue.length })
      },
    )
    return () => controller.abort()
  }, [releaseError, displayReleaseId, loadDisplay, population, model, scope])

  const rowsFor = (factor: Factor, outcome: FitKey['outcome']) => {
    const result = current?.cells[cellId(factor, outcome)]?.result
    return result ? displayPairs(result, componentCategories[factor][0] ?? null) : []
  }
  const bounds = Object.fromEntries(
    PANEL_ORDER.map((outcome) => [
      outcome,
      plotBound(FACTOR_ORDER.flatMap((factor) => rowsFor(factor, outcome))),
    ]),
  ) as Record<FitKey['outcome'], number | null>
  const hasLowDfOverallTest = FACTOR_ORDER.some((factor) =>
    PANEL_ORDER.some((outcome) => {
      const test = current?.cells[cellId(factor, outcome)]?.result?.tests.find(
        (item) => item.kind === 'endpoint',
      )
      return (
        test?.status === 'LOW_EFFECTIVE_DF' && test.pValue !== null && test.pValue !== undefined
      )
    }),
  )
  const busy = Boolean(
    displayReleaseId && !releaseError && (!current || current.completed < current.total),
  )
  const exportReady = Boolean(
    displayReleaseId &&
      !releaseError &&
      !busy &&
      current &&
      Object.values(current.cells).length === FACTOR_ORDER.length * PANEL_ORDER.length &&
      Object.values(current.cells).every((cell) => cell.result),
  )
  function exportOverview() {
    if (!displayReleaseId || !exportReady) throw new Error('FIGURE_SCOPE_NOT_READY')
    return componentSummarySvg({
      releaseId: displayReleaseId,
      population,
      model,
      factors: FACTOR_ORDER.map((factor) => ({
        factor,
        categoryCodes: componentCategories[factor],
        cells: PANEL_ORDER.map((outcome) => {
          const cell = current?.cells[cellId(factor, outcome)]
          if (!cell?.result) throw new Error('Comparison is unavailable')
          return { outcome, result: cell.result }
        }),
      })),
    })
  }
  if (releaseError)
    return (
      <div className="error" role="status">
        Results could not be loaded.
      </div>
    )
  if (!displayReleaseId)
    return (
      <div className="component-overview-loading" role="status">
        Loading comparisons...
      </div>
    )

  return (
    <section className="component-overview" aria-labelledby="comparison-figure-title">
      <div className="component-overview-heading">
        <p className="component-overview-scope">
          {MODEL_LABELS[model]} | {POPULATION_LABELS[population]} | Five blood unit characteristics
        </p>
        <SummaryDownload
          ready
          createSvg={exportOverview}
          filename={`blood-unit-comparisons-${COHORT_SLUG[population]}-${MODEL_FILENAME[model]}.svg`}
          disabled={!exportReady}
        />
      </div>
      {busy && (
        <p className="component-overview-progress" role="status">
          Loading comparisons{current?.total ? ` (${current.completed} of ${current.total})` : ''}
          ...
        </p>
      )}
      <div
        className="component-overview-scroll"
        role="region"
        tabIndex={0}
        aria-label="Differences in change by blood unit characteristic"
        aria-describedby={`${id}-key ${id}-instruction`}
        aria-busy={busy}
      >
        <table className="component-overview-table">
          <caption className="component-overview-accessible">
            Category minus reference differences in change. Select a characteristic and outcome to
            explore the complete comparisons.
          </caption>
          <colgroup>
            <col className="component-overview-label-column" />
            {PANEL_ORDER.map((outcome) => (
              <col key={outcome} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Category</th>
              {PANEL_ORDER.map((outcome) => {
                const meta = OUTCOME_META[outcome]
                return (
                  <th scope="col" key={outcome}>
                    <strong style={{ color: meta.color }}>{meta.shortName}</strong>
                    <span className="component-overview-outcome-name">
                      {OUTCOME_HEADING_LINES[outcome].map((line, index) => (
                        <span key={line}>
                          {line}
                          {index === 0 ? ' ' : ''}
                        </span>
                      ))}
                    </span>
                    <span className="component-overview-unit">{meta.changeUnit}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          {FACTOR_ORDER.map((factor) => {
            const codes = componentCategories[factor]
            const reference = codes[0]
            const height = Math.max(codes.length * CATEGORY_ROW_HEIGHT, 36) + 4
            return (
              <tbody key={factor}>
                <tr className="component-overview-factor">
                  <th scope="rowgroup">
                    <span className="component-overview-factor-heading">
                      <span>{FACTOR_LABELS[factor]}</span>
                    </span>
                  </th>
                  {PANEL_ORDER.map((outcome) => {
                    const test = current?.cells[cellId(factor, outcome)]?.result?.tests.find(
                      (item) => item.kind === 'endpoint',
                    )
                    const available =
                      test?.pValue !== null &&
                      test?.pValue !== undefined &&
                      (test.status === 'COMPUTED' || test.status === 'LOW_EFFECTIVE_DF')
                    return (
                      <td key={outcome}>
                        <span
                          className="component-overview-overall"
                          title={
                            available
                              ? `Overall equality of category changes; unadjusted for multiple comparisons${test.status === 'LOW_EFFECTIVE_DF' ? '; low effective degrees of freedom' : ''}`
                              : 'Overall test unavailable'
                          }
                        >
                          {available
                            ? `p ${overallProbability(test.pValue)}${test.status === 'LOW_EFFECTIVE_DF' ? '†' : ''}`
                            : 'p unavailable'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <th scope="row" className="component-overview-category-list">
                    <span className="component-overview-accessible">
                      {FACTOR_LABELS[factor]} categories:{' '}
                    </span>
                    <ul style={{ minHeight: height }}>
                      {codes.map((code) => (
                        <li
                          key={code}
                          className={code === reference ? 'component-reference-label' : undefined}
                        >
                          {categoryCaption(factor, code)}
                          {code === reference && ' (reference)'}
                        </li>
                      ))}
                    </ul>
                  </th>
                  {PANEL_ORDER.map((outcome) => {
                    const key = cellId(factor, outcome),
                      meta = OUTCOME_META[outcome]
                    const cell = current?.cells[key]
                    const rows = rowsFor(factor, outcome)
                    const bound = bounds[outcome]
                    const message = cell?.message
                    const descriptionId = `${id}-${factor}-${outcome}`
                    const hasReference = Boolean(
                      cell?.result?.activeCategoryCodes.includes(reference!) &&
                        cell.result.categories.some(
                          (category) =>
                            category.code === reference && category.status === 'COMPUTED',
                        ),
                    )
                    const description =
                      (hasReference
                        ? `${categoryCaption(factor, reference!)}: reference; zero by definition, with no confidence interval or p value. `
                        : '') +
                      (rows.length
                        ? rows.map((row) => pairDescription(factor, row, meta.changeUnit)).join(' ')
                        : (message ?? 'Loading comparisons.'))
                    return (
                      <td key={outcome}>
                        <button
                          type="button"
                          className="component-overview-panel"
                          style={{ minHeight: height }}
                          disabled={reference === undefined}
                          aria-label={`Explore ${FACTOR_LABELS[factor]}: ${meta.name}`}
                          aria-describedby={descriptionId}
                          onClick={() =>
                            reference !== undefined &&
                            onExplore({ population, model, factor, outcome }, reference)
                          }
                        >
                          {message ? (
                            <span className="component-overview-unavailable">
                              <strong>Unavailable</strong>
                              <span>{message}</span>
                            </span>
                          ) : !cell?.result ? (
                            <span className="component-overview-cell-loading">Loading...</span>
                          ) : (
                            <svg
                              viewBox={`0 0 128 ${height}`}
                              height={height}
                              preserveAspectRatio="none"
                              aria-hidden="true"
                            >
                              {bound !== null && (
                                <line
                                  x1={pointX(0, bound)}
                                  x2={pointX(0, bound)}
                                  y1={4}
                                  y2={height - 4}
                                  className="component-overview-zero"
                                  vectorEffect="non-scaling-stroke"
                                />
                              )}
                              {hasReference && (
                                <g
                                  className="component-overview-reference"
                                >
                                  <title>
                                    {categoryCaption(factor, reference!)}: reference; zero by
                                    definition, with no confidence interval or p value.
                                  </title>
                                  <path
                                    d={`M64,${CATEGORY_POINT_OFFSET}h0.001`}
                                    stroke="#78847f"
                                    strokeWidth={7}
                                    strokeLinecap="round"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                  <path
                                    d={`M64,${CATEGORY_POINT_OFFSET}h0.001`}
                                    stroke="white"
                                    strokeWidth={4}
                                    strokeLinecap="round"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </g>
                              )}
                              {rows.map((row, index) => {
                                const y = CATEGORY_POINT_OFFSET + (index + 1) * CATEGORY_ROW_HEIGHT
                                return row.estimate !== null &&
                                  row.lower !== null &&
                                  row.upper !== null &&
                                  bound !== null ? (
                                  <g
                                    key={row.id}
                                    className="component-overview-estimate"
                                  >
                                    <title>{pairDescription(factor, row, meta.changeUnit)}</title>
                                    <line
                                      x1={pointX(row.lower, bound)}
                                      x2={pointX(row.upper, bound)}
                                      y1={y}
                                      y2={y}
                                      stroke={meta.color}
                                      strokeWidth={1.7}
                                      vectorEffect="non-scaling-stroke"
                                    />
                                    <line
                                      x1={pointX(row.lower, bound)}
                                      x2={pointX(row.lower, bound)}
                                      y1={y - 3}
                                      y2={y + 3}
                                      stroke={meta.color}
                                      vectorEffect="non-scaling-stroke"
                                    />
                                    <line
                                      x1={pointX(row.upper, bound)}
                                      x2={pointX(row.upper, bound)}
                                      y1={y - 3}
                                      y2={y + 3}
                                      stroke={meta.color}
                                      vectorEffect="non-scaling-stroke"
                                    />
                                    <path
                                      d={`M${pointX(row.estimate, bound)},${y}h0.001`}
                                      stroke={meta.color}
                                      strokeWidth={6}
                                      strokeLinecap="round"
                                      vectorEffect="non-scaling-stroke"
                                    />
                                  </g>
                                ) : (
                                  <text
                                    key={row.id}
                                    x={64}
                                    y={y + 3}
                                    textAnchor="middle"
                                    className="component-overview-missing"
                                  >
                                    <title>{pairDescription(factor, row, meta.changeUnit)}</title>—
                                  </text>
                                )
                              })}
                            </svg>
                          )}
                          <span id={descriptionId} className="component-overview-accessible">
                            {description}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            )
          })}
          <tfoot>
            <tr>
              <th scope="row">Difference in change</th>
              {PANEL_ORDER.map((outcome) => {
                const bound = bounds[outcome]
                return (
                  <td key={outcome}>
                    {bound === null ? (
                      <span className="component-overview-no-scale">No estimates</span>
                    ) : (
                      <svg
                        viewBox="0 0 128 26"
                        height={26}
                        preserveAspectRatio="none"
                        aria-label={`Scale: ${formatTick(-bound)} to ${formatTick(bound)} ${OUTCOME_META[outcome].changeUnit}`}
                        role="img"
                      >
                        <line
                          x1={12}
                          x2={116}
                          y1={3}
                          y2={3}
                          className="component-overview-axis"
                          vectorEffect="non-scaling-stroke"
                        />
                        {[-bound, 0, bound].map((value) => (
                          <g key={value}>
                            <line
                              x1={pointX(value, bound)}
                              x2={pointX(value, bound)}
                              y1={3}
                              y2={7}
                              className="component-overview-axis"
                            />
                            <text
                              x={pointX(value, bound)}
                              y={21}
                              textAnchor={value < 0 ? 'start' : value > 0 ? 'end' : 'middle'}
                            >
                              {formatTick(value)}
                            </text>
                          </g>
                        ))}
                      </svg>
                    )}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="component-overview-explanation">
        <p className="component-overview-key">
          Each estimate is the predicted two-hour change in the displayed category minus that in its
          reference category, from one hour before to one hour after transfusion start.
        </p>
        <p className="component-overview-key" id={`${id}-key`}>
          Bars show pointwise 95% confidence intervals. Open circles mark the reference at zero.
          Each unadjusted overall p value tests whether the two-hour change differs across
          categories.
        </p>
        <p className="component-overview-instruction" id={`${id}-instruction`}>
          Select a panel to explore comparisons for that outcome and blood unit characteristic.
        </p>
      </div>
      <details className="component-overview-notes">
        <summary>Units and comparison definitions</summary>
        {hasLowDfOverallTest && (
          <p>A dagger (†) denotes low effective degrees of freedom for the overall test.</p>
        )}
        <p>
          Positive estimates indicate a greater increase or smaller decrease than in the reference
          category. Scales are shared within each outcome column.
        </p>
        <p>
          Detailed pairwise p values are Holm-adjusted within each combination of characteristic,
          outcome, cohort and model. Confidence intervals are pointwise and are not adjusted for
          multiple comparisons.
        </p>
        <p>FiO₂ and SpO₂ changes are expressed in percentage points.</p>
        <p>
          <strong>FiO₂.</strong> {OUTCOME_META.FIO2.unitNote}
        </p>
        <p>
          <strong>Minute ventilation.</strong> {OUTCOME_META.VE.unitNote}
        </p>
        <p>
          <strong>Donor parity.</strong> {PARITY_NOTE}
        </p>
      </details>
    </section>
  )
}
