import { useEffect, useState } from 'react'
import type { FitKey } from '../data/release'
import {
  COMPONENT_FACTOR_ORDER,
  FACTOR_LABELS,
  OUTCOME_META,
  categoryCaption,
  PARITY_NOTE,
  MODEL_LABELS,
  POPULATION_LABELS,
} from '../data/display'
import { isResultUnavailable } from '../data/reader'
import {
  overallProbability,
  type DisplayComparisonLoader,
  type DisplayComparison,
} from '../data/componentDisplay'
import { displayPairs } from '../data/pairwiseDisplay'
import ForestPlot, { type ForestRow } from './ForestPlot'
import './allPairsOverview.css'

type Factor = Exclude<FitKey['factor'], 'MAIN'>
export interface AllPairsOverviewProps {
  displayReleaseId?: string
  loadDisplay: DisplayComparisonLoader
  releaseError: boolean
  model: FitKey['model']
  population: FitKey['population']
  outcome: FitKey['outcome']
  onExplore?: (key: FitKey) => void
}
interface Group {
  state: 'loading' | 'accepted' | 'unavailable'
  message?: string
  rows?: readonly ForestRow[]
  result?: DisplayComparison
}
const ORDER = COMPONENT_FACTOR_ORDER
/** Complete exported A-minus-B families for one outcome; no reference reorientation. */
export default function AllPairsOverview({
  releaseError,
  model,
  population,
  outcome,
  onExplore,
  displayReleaseId,
  loadDisplay,
}: AllPairsOverviewProps) {
  const scope = `${displayReleaseId}/${population}/${model}/${outcome}`
  const [loaded, setLoaded] = useState<{ scope: string; groups: Partial<Record<Factor, Group>> }>({
    scope: '',
    groups: {},
  })
  const groups = loaded.scope === scope ? loaded.groups : {}
  useEffect(() => {
    if (!displayReleaseId || releaseError) return
    const controller = new AbortController()
    setLoaded({ scope, groups: {} })
    const store = (factor: Factor, group: Group) => {
      if (!controller.signal.aborted)
        setLoaded((previous) =>
          previous.scope === scope
            ? { ...previous, groups: { ...previous.groups, [factor]: group } }
            : previous,
        )
    }
    for (const factor of ORDER) {
      const key: FitKey = { population, model, outcome, factor }
      store(factor, { state: 'loading' })
      loadDisplay(key, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          const rows = displayPairs(result, null).map((pair) => ({
            id: pair.id,
            label: `${categoryCaption(factor, pair.a)} versus ${categoryCaption(factor, pair.b)}`,
            comparison: {
              first: categoryCaption(factor, pair.a),
              second: categoryCaption(factor, pair.b),
            },
            estimate: pair.estimate,
            lower: pair.lower,
            upper: pair.upper,
            holmP: pair.holmP,
            unavailableLabel: 'Unavailable',
          }))
          store(factor, { state: 'accepted', result, rows })
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            store(factor, {
              state: 'unavailable',
              message: isResultUnavailable(error)
                ? 'These comparisons are unavailable.'
                : 'These comparisons could not be loaded.',
            })
        })
    }
    return () => controller.abort()
  }, [displayReleaseId, loadDisplay, releaseError, model, population, outcome, scope])
  if (releaseError)
    return (
      <div className="error" role="status">
        Results could not be loaded.
      </div>
    )
  if (!displayReleaseId) return <p role="status">Loading comparisons...</p>
  const hasLowDfOverallTest = ORDER.some((factor) => {
    const group = groups[factor],
      test = group?.result?.tests.find((item) => item.kind === 'endpoint')
    return group?.state === 'accepted' && test?.status === 'LOW_EFFECTIVE_DF' && test.pValue != null
  })
  const meta = OUTCOME_META[outcome]
  const values = Object.values(groups)
    .flatMap((group) => (group.rows ?? []).flatMap((row) => [row.estimate, row.lower, row.upper]))
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const extent = Math.max(...values.map(Math.abs), 0.01) * 1.12
  const step = 10 ** Math.floor(Math.log10(extent)),
    sharedBound = Math.ceil(extent / step) * step
  const dialogContext = (
    <>
      <p>
        {MODEL_LABELS[model]}; {POPULATION_LABELS[population]}. Predicted change from one hour
        before to one hour after transfusion start. Each comparison subtracts the second category’s
        change from the first.
      </p>
      {(outcome === 'FIO2' || outcome === 'SPO2') && (
        <p>Changes are expressed in percentage points.</p>
      )}
    </>
  )
  return (
    <section className="all-pairs-overview" aria-label={`${meta.name}: all blood unit comparisons`}>
      <p className="all-pairs-definition">
        Change is the predicted value one hour after transfusion start minus the value one hour
        before start. Each estimate is the first category’s change minus the second’s. A positive
        value indicates a greater rise or smaller fall in the first category.
      </p>
      <p className="all-pairs-scroll-note">Scroll panels horizontally for all columns.</p>
      <div className="all-pairs-grid">
        {ORDER.map((factor) => {
          const group = groups[factor],
            title = FACTOR_LABELS[factor],
            overall = group?.result?.tests.find((test) => test.kind === 'endpoint')
          return (
            <section
              className={`all-pairs-card${factor === 'DonorHb_Cat' || factor === 'Storage_Cat' ? ' all-pairs-card-wide' : ''}`}
              key={factor}
              data-factor={factor}
              aria-label={title}
              tabIndex={0}
            >
              <div className="all-pairs-card-heading">
                <h3>
                  {title}
                  {factor === 'wdy_donation' && <small>Monday to Friday</small>}
                </h3>
                {group?.state === 'accepted' && (
                  <span
                    className="all-pairs-overall"
                    title="Unadjusted overall test of equal two-hour changes across categories"
                  >
                    Overall p {overallProbability(overall?.pValue)}
                    {overall?.status === 'LOW_EFFECTIVE_DF' && overall.pValue != null ? '†' : ''}
                  </span>
                )}
              </div>
              {group?.state === 'accepted' && group.rows ? (
                <>
                  <ForestPlot
                    rows={group.rows}
                    title={`${meta.name}: ${title}, all pairwise differences`}
                    unit={meta.changeUnit}
                    color={meta.color}
                    zeroLabel="equal changes"
                    showHolm
                    stackComparisonLabels
                    rowHeading="First vs second category"
                    showLegend={false}
                    axisBound={sharedBound}
                    context={dialogContext}
                  />
                  {onExplore && (
                    <button
                      type="button"
                      className="all-pairs-details"
                      onClick={() => onExplore({ population, model, outcome, factor })}
                    >
                      Reference comparisons
                    </button>
                  )}
                </>
              ) : (
                <p className="all-pairs-unavailable" role="status">
                  {group?.state === 'unavailable' ? group.message : 'Loading comparisons...'}
                </p>
              )}
            </section>
          )
        })}
      </div>
      <p className="all-pairs-note">
        Dots show estimated differences and bars show pointwise 95% confidence intervals. All five
        characteristics use the same horizontal scale for this outcome. Pairwise p values are
        Holm-adjusted within each combination of characteristic, outcome, cohort and model.
        Unadjusted overall p values test whether the two-hour change differs across categories.
        {hasLowDfOverallTest && ' A dagger (†) denotes low effective degrees of freedom.'}
      </p>
      <p className="all-pairs-note">
        {PARITY_NOTE} Donation weekday models include all seven days. Reported comparisons cover
        Monday through Friday. FiO₂ and SpO₂ changes are expressed in percentage points.
      </p>
    </section>
  )
}
