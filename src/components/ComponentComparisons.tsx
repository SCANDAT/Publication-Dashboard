import { useEffect, useRef, useState } from 'react'
import { OUTCOMES, POPULATIONS, type FitKey } from '../data/release'
import {
  COHORT_SLUG,
  comparisonOverviewTitle,
  pairwiseOverviewTitle,
  FACTOR_ADDRESS,
  outcomeAddress,
  categoryAddress,
  readSelection,
  COMPONENT_FACTOR_ORDER,
  FACTOR_LABELS,
  FULL_MODEL_NOTE,
  MODEL_LABELS,
  OUTCOME_META,
  POPULATION_LABELS,
  PARITY_NOTE,
  PANEL_ORDER,
  categoryCaption,
} from '../data/display'
import { isResultUnavailable, readDisplay } from '../data/reader'
import {
  componentCategories,
  componentDisplayKey,
  formatProbability,
  validateComponentDisplay,
  type DisplayComparison,
  type DisplayComparisonLoader,
} from '../data/componentDisplay'
import { formatValue } from './trajectoryGeometry'
import ForestPlot from './ForestPlot'
import { displayPairs } from '../data/pairwiseDisplay'
import ComponentOverview from './ComponentOverview'
import OptionsPanel from './OptionsPanel'
import CohortSelect from './CohortSelect'
import AllPairsOverview from './AllPairsOverview'

type Factor = Exclude<FitKey['factor'], 'MAIN'>
type Props = { releaseError: boolean; displayReleaseId?: string }
const jointStatusLabels = {
  COMPUTED: '',
  LOW_EFFECTIVE_DF: 'Low effective degrees of freedom',
  INSUFFICIENT_EFFECTIVE_DF: 'Insufficient information for this test',
  NOT_APPLICABLE_SINGLE_CATEGORY: 'Only one category available',
  MOMENT_PRECISION_UNRESOLVED: 'Uncertainty could not be estimated reliably',
  DF2_SIGN_UNRESOLVED: 'Degrees of freedom unavailable',
} as const
const componentFactors = COMPONENT_FACTOR_ORDER
function interval(lower: number | null, upper: number | null) {
  return lower === null || upper === null
    ? 'Unavailable'
    : `${formatValue(lower)} to ${formatValue(upper)}`
}

const loadDisplayComparison: DisplayComparisonLoader = async (key, signal) => {
  const logicalKey = componentDisplayKey(key)
  const data = await readDisplay(logicalKey, signal)
  signal.throwIfAborted()
  return validateComponentDisplay(logicalKey, data)
}

export default function ComponentComparisons({ releaseError, displayReleaseId }: Props) {
  const [view, setView] = useState<'overview' | 'explore' | 'detail'>(() => {
    const query = new URLSearchParams(location.search)
    return query.get('comparison') === 'detail' ||
      (!query.has('comparison') && (query.has('factor') || query.has('outcome')))
      ? 'detail'
      : query.get('comparison') === 'explore'
        ? 'explore'
        : 'overview'
  })
  const detailControls = useRef<HTMLDivElement>(null)
  const selectedOutcomeButton = useRef<HTMLButtonElement>(null)
  const focusSelection = useRef(view !== 'overview')
  const [outcome, setOutcome] = useState<FitKey['outcome']>(
    () =>
      readSelection(new URLSearchParams(location.search), 'outcome', OUTCOMES, outcomeAddress) ??
      'ARTm',
  )
  const [factor, setFactor] = useState<Factor>(
    () =>
      readSelection(
        new URLSearchParams(location.search),
        'factor',
        componentFactors,
        (code) => FACTOR_ADDRESS[code],
      ) ?? 'Storage_Cat',
  )
  const [model, setModel] = useState<FitKey['model']>(() =>
    new URLSearchParams(location.search).get('model') === 'BASE' ? 'BASE' : 'FULL',
  )
  const [population, setPopulation] = useState<FitKey['population']>(
    () =>
      readSelection(
        new URLSearchParams(location.search),
        'population',
        POPULATIONS,
        (code) => COHORT_SLUG[code],
      ) ?? 'PRIMARY',
  )
  const [loaded, setLoaded] = useState<{
    selection: string
    result?: DisplayComparison
    message?: string
  }>({ selection: '' })
  const [reference, setReference] = useState(() => {
    const query = new URLSearchParams(location.search)
    const validFactor =
      !query.has('factor') ||
      readSelection(query, 'factor', componentFactors, (code) => FACTOR_ADDRESS[code]) === factor
    const reference = validFactor
      ? readSelection(query, 'reference', componentCategories[factor], (code) =>
          categoryAddress(factor, code),
        )
      : undefined
    return { factor, code: reference ?? componentCategories[factor][0]! }
  })
  const [allPairs, setAllPairs] = useState(
    () => new URLSearchParams(location.search).getAll('allPairs').join(',') === '1',
  )
  const [showHolm, setShowHolm] = useState(
    () => new URLSearchParams(location.search).getAll('adjustedP').join(',') === '1',
  )
  const selection = `${displayReleaseId}/${population}/${model}/${factor}/${outcome}`
  const result = loaded.selection === selection ? loaded.result : undefined
  const message = loaded.selection === selection ? loaded.message : undefined
  const meta = OUTCOME_META[outcome]
  const orderedPairs = result ? displayPairs(result, null) : []
  const categoryCodes = result?.plannedCategoryCodes ?? componentCategories[factor]
  const referenceCode =
    reference.factor === factor && categoryCodes.includes(reference.code)
      ? reference.code
      : categoryCodes[0]!
  const plottedPairs = result ? displayPairs(result, allPairs ? null : referenceCode) : []

  useEffect(() => {
    if (!displayReleaseId || releaseError || view !== 'detail') return
    const controller = new AbortController()
    const key: FitKey = { population, model, factor, outcome }
    setLoaded({ selection })
    loadDisplayComparison(key, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLoaded({ selection, result })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoaded({
            selection,
            message: isResultUnavailable(error)
              ? 'These comparisons are unavailable.'
              : 'These comparisons could not be loaded.',
          })
      })
    return () => controller.abort()
  }, [displayReleaseId, releaseError, outcome, factor, population, model, selection, view])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('factor', FACTOR_ADDRESS[factor])
    url.searchParams.set('outcome', outcomeAddress(outcome))
    url.searchParams.set('model', model)
    url.searchParams.set('population', COHORT_SLUG[population])
    url.searchParams.set('comparison', view)
    url.searchParams.set('reference', categoryAddress(factor, referenceCode))
    if (allPairs) url.searchParams.set('allPairs', '1')
    else url.searchParams.delete('allPairs')
    if (showHolm) url.searchParams.set('adjustedP', '1')
    else url.searchParams.delete('adjustedP')
    history.replaceState(null, '', url)
  }, [factor, outcome, model, population, view, referenceCode, allPairs, showHolm])

  useEffect(() => {
    if (!focusSelection.current || (!displayReleaseId && !releaseError)) return
    const target = view === 'detail' ? detailControls.current : selectedOutcomeButton.current
    target?.focus()
    focusSelection.current = false
  }, [view, displayReleaseId, releaseError])

  function openComparison(key: FitKey, referenceCode: string) {
    setFactor(key.factor as Factor)
    setOutcome(key.outcome)
    setModel(key.model)
    setPopulation(key.population)
    setReference({ factor: key.factor as Factor, code: referenceCode })
    setAllPairs(false)
    if (detailControls.current) detailControls.current.focus()
    else focusSelection.current = true
    setView('detail')
  }

  return (
    <div className="comparison-view">
      <div className="figure-heading">
        <h2 id="comparison-figure-title">
          {comparisonOverviewTitle(displayReleaseId, population, model)}
        </h2>
      </div>
      <p className="report-note">
        For each characteristic, an event contributed only when every unit started at that event had
        a known, valid value in the same category. For donor sex, the male reference includes only
        events in which every unit came from a known male donor. The descriptive unit table groups
        male and unclassified units together.
      </p>
      <OptionsPanel
        className="comparison-options"
        label="Comparison cohort and model"
        summary={`${POPULATION_LABELS[population]}; ${MODEL_LABELS[model]}`}
      >
        <div className="controls">
          <CohortSelect label="Cohort" value={population} onChange={setPopulation} />
          <label>
            Model
            <select
              aria-label="Model"
              value={model}
              onChange={(event) => setModel(event.target.value as FitKey['model'])}
            >
              {(['FULL', 'BASE'] as const).map((code) => (
                <option value={code} key={code}>
                  {MODEL_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </OptionsPanel>
      <button type="button" className="skip" onClick={() => selectedOutcomeButton.current?.focus()}>
        Skip to comparisons by outcome
      </button>
      <ComponentOverview
        displayReleaseId={displayReleaseId}
        loadDisplay={loadDisplayComparison}
        releaseError={releaseError}
        model={model}
        population={population}
        onExplore={openComparison}
      />
      <h3 className="comparison-explorer-heading" id="comparison-outcome-title">
        {view === 'detail'
          ? `Pairwise comparisons for ${meta.name.toLowerCase()}`
          : pairwiseOverviewTitle(displayReleaseId, population, model, outcome)}
      </h3>
      <div className="outcome-pills" role="group" aria-label="Outcome">
        {PANEL_ORDER.map((code) => (
          <button
            type="button"
            key={code}
            ref={outcome === code ? selectedOutcomeButton : undefined}
            aria-label={OUTCOME_META[code].name}
            aria-pressed={outcome === code}
            title={OUTCOME_META[code].name}
            style={{
              color: OUTCOME_META[code].color,
              borderColor: outcome === code ? OUTCOME_META[code].color : undefined,
              backgroundColor: outcome === code ? `${OUTCOME_META[code].color}12` : undefined,
            }}
            onClick={() => {
              setOutcome(code)
              if (view === 'overview') setView('explore')
            }}
          >
            {OUTCOME_META[code].shortName}
          </button>
        ))}
        <span>
          {meta.name} &middot; {meta.changeUnit}
        </span>
      </div>
      {view === 'detail' && (
        <div
          className="controls comparison-controls primary-controls"
          ref={detailControls}
          tabIndex={-1}
          role="group"
          aria-label="Comparison selection"
        >
          <label>
            Blood unit characteristic
            <select
              aria-label="Blood unit characteristic"
              value={factor}
              onChange={(event) => {
                const next = event.target.value as Factor
                setFactor(next)
                setReference({ factor: next, code: componentCategories[next][0]! })
              }}
            >
              {componentFactors.map((code) => (
                <option value={code} key={code}>
                  {FACTOR_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {view === 'detail' && factor === 'DonorParity_Female' && (
        <p className="report-note">{PARITY_NOTE}</p>
      )}
      {view === 'detail' && factor === 'wdy_donation' && result && (
        <p className="report-note">
          Donation weekday models include all seven days. Reported comparisons cover Monday through
          Friday.
        </p>
      )}
      {view === 'detail' && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setView('explore')
            selectedOutcomeButton.current?.focus()
          }}
        >
          All pairwise comparisons for this outcome
        </button>
      )}
      {view !== 'detail' ? (
        <AllPairsOverview
          displayReleaseId={displayReleaseId}
          loadDisplay={loadDisplayComparison}
          releaseError={releaseError}
          model={model}
          population={population}
          outcome={outcome}
          onExplore={(key) => {
            const first = componentCategories[key.factor as Factor][0]
            if (first !== undefined) openComparison(key, first)
          }}
        />
      ) : releaseError || message ? (
        <div className="error" role="status">
          {releaseError ? 'Results could not be loaded.' : message}
        </div>
      ) : !result ? (
        <div className="card-empty" role="status">
          Loading comparisons...
        </div>
      ) : (
        <>
          <section className="comparison-section" aria-labelledby="pairwise-title">
            <div className="section-title">
              <div>
                <h3 id="pairwise-title">Difference in change</h3>
                <p>
                  {meta.name} &middot; {meta.changeUnit}
                </p>
              </div>
            </div>
            <div className="contrast-controls">
              {!allPairs && (
                <label className="compact-control">
                  Compare each category with
                  <select
                    aria-label="Compare each category with"
                    value={referenceCode}
                    onChange={(event) => setReference({ factor, code: event.target.value })}
                  >
                    {result.plannedCategoryCodes.map((code) => (
                      <option value={code} key={code}>
                        {categoryCaption(factor, code)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={allPairs}
                  onChange={(event) => setAllPairs(event.target.checked)}
                />
                Show all pairs
              </label>
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={showHolm}
                  onChange={(event) => setShowHolm(event.target.checked)}
                />
                Show adjusted p values
              </label>
            </div>
            <p className="contrast-definition">
              {allPairs ? (
                'Each comparison is the change in the first category minus the change in the second category.'
              ) : (
                <>
                  Each comparison is the change in the displayed category minus the change for{' '}
                  <strong>{categoryCaption(factor, referenceCode)}</strong>.
                </>
              )}{' '}
              Change is the predicted value one hour after transfusion start minus the predicted
              value one hour before start.
            </p>
            <ForestPlot
              context={`${meta.name}; ${FACTOR_LABELS[factor]}; ${MODEL_LABELS[model]}; ${POPULATION_LABELS[population]}; predicted change from 1 h before to 1 h after transfusion start${outcome === 'FIO2' || outcome === 'SPO2' ? '; changes in percentage points' : ''}`}
              title="Differences between category changes"
              rowHeading={allPairs ? 'Comparison' : 'Category'}
              unit={meta.changeUnit}
              color={meta.color}
              zeroLabel="no difference in change"
              showHolm={showHolm}
              reference={
                !allPairs &&
                result.activeCategoryCodes.includes(referenceCode) &&
                result.categories.some(
                  (category) => category.code === referenceCode && category.status === 'COMPUTED',
                )
                  ? { label: categoryCaption(factor, referenceCode) }
                  : undefined
              }
              rows={plottedPairs.map((pair) => ({
                id: pair.id,
                label: allPairs
                  ? `${categoryCaption(factor, pair.a)} versus ${categoryCaption(factor, pair.b)}`
                  : categoryCaption(factor, pair.a),
                estimate: pair.estimate,
                lower: pair.lower,
                upper: pair.upper,
                holmP: pair.holmP,
              }))}
            />
            <p className="table-note">
              Confidence intervals are pointwise. −0.00 denotes a negative value that rounds to
              zero. Holm adjustment covers the complete comparison family ({result.pairs.length}{' '}
              comparisons), regardless of the rows displayed. A positive value means a greater rise
              or a smaller fall in the first category than in the second; a negative value means the
              reverse.
            </p>
            <details className="table-details">
              <summary>All pairwise estimates and p values</summary>
              <p className="table-scroll-hint" id="pairwise-scroll-hint">
                Scroll horizontally for all columns.
              </p>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Pairwise differences in change"
                aria-describedby="pairwise-scroll-hint"
              >
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th scope="col">First category</th>
                      <th scope="col">Second category</th>
                      <th scope="col">Difference in change</th>
                      <th scope="col">95% CI</th>
                      <th scope="col">Unadjusted p</th>
                      <th scope="col">Holm-adjusted p</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedPairs.map((pair) => (
                      <tr key={pair.id}>
                        <th scope="row">{categoryCaption(factor, pair.a)}</th>
                        <td>{categoryCaption(factor, pair.b)}</td>
                        <td>{formatValue(pair.estimate)}</td>
                        <td>{interval(pair.lower, pair.upper)}</td>
                        <td>{formatProbability(pair.pValue)}</td>
                        <td>{formatProbability(pair.holmP)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <details className="comparison-section supporting-section">
            <summary>Change within each category</summary>
            <p className="contrast-definition">
              The −1 to +1 hour change in each category, relative to transfusion start.
            </p>
            <ForestPlot
              context={`${meta.name}; ${FACTOR_LABELS[factor]}; ${MODEL_LABELS[model]}; ${POPULATION_LABELS[population]}; predicted change from 1 h before to 1 h after transfusion start${outcome === 'FIO2' || outcome === 'SPO2' ? '; changes in percentage points' : ''}`}
              title="Change within each category"
              unit={meta.changeUnit}
              color={meta.color}
              zeroLabel="no change"
              rows={result.categories.map((category) => ({
                id: category.code,
                label: categoryCaption(factor, category.code),
                estimate: category.estimate,
                lower: category.lower,
                upper: category.upper,
              }))}
            />
          </details>
          <section className="overall-section" aria-labelledby="overall-heading">
            <h3 id="overall-heading">Overall comparisons</h3>
            <div className="joint-tests">
              {(['endpoint', 'trajectory'] as const).map((kind) => {
                const test = result.tests.find((item) => item.kind === kind)
                return (
                  <section className="joint-test" key={kind}>
                    <div>
                      <h4>
                        {kind === 'endpoint'
                          ? 'Changes from −1 to +1 hour'
                          : 'Trajectory shape over 24 hours'}
                      </h4>
                      <p>
                        {kind === 'endpoint'
                          ? 'Tests whether the predicted change from one hour before to one hour after transfusion start differs across categories.'
                          : 'Tests whether the shape of the trajectory differs across categories from 12 hours before to 12 hours after transfusion start.'}
                      </p>
                    </div>
                    <div className="test-value">
                      <span>Unadjusted p</span>
                      <strong>{formatProbability(test?.pValue ?? null)}</strong>
                      {test && test.status !== 'COMPUTED' && (
                        <small>{jointStatusLabels[test.status]}</small>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          </section>
          <details className="method-note">
            <summary>Interpretation and statistical methods</summary>
            <p>
              The selected reference determines which category is subtracted from each displayed
              category.
            </p>
            <p>
              Holm adjustment applies to all pairwise comparisons for this characteristic, outcome,
              cohort and model. The overall tests and pointwise confidence intervals are unadjusted
              for multiple comparisons.
            </p>
            <p>
              These estimates describe associations between blood unit characteristics and changes
              in physiology.
            </p>
            {model === 'FULL' && <p>{FULL_MODEL_NOTE}</p>}
          </details>
        </>
      )}
    </div>
  )
}
