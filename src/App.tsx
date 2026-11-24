import { Fragment, useEffect, useMemo, useState } from 'react'
import { OUTCOMES, POPULATIONS, type FitKey } from './data/release'
import { isResultUnavailable, openReader, readDisplay } from './data/reader'
import { displayEndpoints, displayTrajectory } from './data/mainDisplay'
import { type TrajectoryPoint } from './data/tables'
import {
  FULL_MODEL_NOTE,
  REFERENCE_PROFILE_NOTE,
  MODEL_LABELS,
  OUTCOME_META,
  POPULATION_LABELS,
  POPULATION_NOTES,
  PANEL_ORDER,
  trajectoryTitle,
  timeWindowLabel,
  COHORT_SLUG,
  MODEL_FILENAME,
  readSelection,
} from './data/display'
import MainResultsTable, { type EndpointResult } from './components/MainResultsTable'
import TrajectoryChart from './components/TrajectoryChart'
import ComponentComparisons from './components/ComponentComparisons'
import CohortSelect from './components/CohortSelect'
import StudyPopulation from './components/StudyPopulation'
import ObservedPatterns from './components/ObservedPatterns'
import SensitivityAnalyses from './components/SensitivityAnalyses'
import { curveDomain, formatValue, type CurveDomain } from './components/trajectoryGeometry'
import './components/trajectoryLayout.css'
import SummaryDownload from './components/SummaryDownload'
import OptionsPanel from './components/OptionsPanel'
import { trajectorySummarySvg } from './figures/summarySvg'

type Outcome = (typeof OUTCOMES)[number]
type Card = {
  state: 'loading' | 'ready' | 'unavailable' | 'error'
  message?: string
  points?: readonly TrajectoryPoint[]
  endpoint?: { estimate: number | null; lower: number | null; upper: number | null }
}
const ordered: readonly Outcome[] = PANEL_ORDER
const views = [
  'Main results',
  'Blood unit comparisons',
  'Sensitivity analyses',
  'Observed patterns',
  'Study characteristics',
] as const

const methodsRevision = import.meta.env.VITE_METHODS_REVISION || 'main'
const methodsUrl = `https://github.com/SCANDAT/Publication-Dashboard/blob/${methodsRevision}/analysis/README.md`

const resultParameters = [
  'model',
  'population',
  'scale',
  'minutes',
  'outcome',
  'factor',
  'comparison',
  'reference',
  'allPairs',
  'adjustedP',
  'span',
]
const routes: Record<(typeof views)[number], { id: string; parameters: string[] }> = {
  'Main results': { id: 'trajectories', parameters: ['model', 'population', 'scale', 'minutes'] },
  'Blood unit comparisons': {
    id: 'components',
    parameters: [
      'model',
      'population',
      'outcome',
      'factor',
      'comparison',
      'reference',
      'allPairs',
      'adjustedP',
    ],
  },
  'Sensitivity analyses': { id: 'sensitivity', parameters: ['model'] },
  'Observed patterns': { id: 'observed', parameters: ['outcome', 'scale', 'minutes', 'span'] },
  'Study characteristics': { id: 'population', parameters: ['population'] },
}

export default function App() {
  const [navigation, setNavigation] = useState(0)
  useEffect(() => {
    const restoreView = () => setNavigation((value) => value + 1)
    window.addEventListener('popstate', restoreView)
    return () => window.removeEventListener('popstate', restoreView)
  }, [])
  return <Dashboard key={navigation} />
}

function Dashboard() {
  const [view, setView] = useState<(typeof views)[number]>(() => {
    const selected = new URLSearchParams(location.search).get('view')
    return selected === 'components'
      ? 'Blood unit comparisons'
      : selected === 'observed'
        ? 'Observed patterns'
        : selected === 'population'
          ? 'Study characteristics'
          : selected === 'sensitivity'
            ? 'Sensitivity analyses'
            : 'Main results'
  })
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
  const [scale, setScale] = useState<'levels' | 'changes'>(() =>
    new URLSearchParams(location.search).get('scale') === 'levels' ? 'levels' : 'changes',
  )
  const [windowMinutes, setWindowMinutes] = useState(() => {
    const value = Number(new URLSearchParams(location.search).get('minutes'))
    return [60, 360, 720].includes(value) ? value : 720
  })
  const [publicationView, setPublicationView] = useState(0)
  const [retry, setRetry] = useState(0)
  const [releaseId, setReleaseId] = useState<string>()
  const [releaseError, setReleaseError] = useState(false)
  const [endpointResults, setEndpointResults] = useState<
    Partial<Record<FitKey['model'], EndpointResult>>
  >({})
  const selectedEndpoints = endpointResults[model]
  const showMainResults = view === 'Main results'
  const [loaded, setLoaded] = useState<{ key: string; cards: Partial<Record<Outcome, Card>> }>({
    key: '',
    cards: {},
  })
  const selection = `${releaseId ?? ''}/${population}/${model}/${scale}`
  const cards = useMemo(() => (loaded.key === selection ? loaded.cards : {}), [loaded, selection])

  useEffect(() => {
    const controller = new AbortController()
    setReleaseId(undefined)
    setReleaseError(false)
    openReader(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setReleaseId(value.releaseId)
      })
      .catch(() => {
        if (!controller.signal.aborted) setReleaseError(true)
      })
    return () => controller.abort()
  }, [retry])

  useEffect(() => {
    if (!releaseId || !showMainResults) return
    const controller = new AbortController()
    setEndpointResults({})
    for (const fit of ['BASE', 'FULL'] as const) {
      const key = 'endpoints/' + fit
      readDisplay(key, controller.signal)
        .then((value) => displayEndpoints(key, value))
        .then((grid) => {
          if (!controller.signal.aborted)
            setEndpointResults((current) => ({ ...current, [fit]: { grid } }))
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setEndpointResults((current) => ({
              ...current,
              [fit]: { state: isResultUnavailable(error) ? 'unavailable' : 'error' },
            }))
        })
    }
    return () => controller.abort()
  }, [releaseId, showMainResults, retry])

  useEffect(() => {
    if (!releaseId || !showMainResults || !selectedEndpoints) return
    const controller = new AbortController()
    setLoaded({ key: selection, cards: {} })
    for (const outcome of ordered) {
      const store = (card: Card) => {
        if (!controller.signal.aborted)
          setLoaded((current) =>
            current.key === selection
              ? { key: selection, cards: { ...current.cards, [outcome]: card } }
              : current,
          )
      }
      const curveKey = ['main', population, model, outcome, scale].join('/')
      if ('state' in selectedEndpoints) {
        store({
          state: selectedEndpoints.state,
          message:
            selectedEndpoints.state === 'unavailable'
              ? 'This result is unavailable.'
              : 'This result could not be loaded.',
        })
        continue
      }
      readDisplay(curveKey, controller.signal)
        .then((value) => displayTrajectory(curveKey, value))
        .then((points) => {
          const [estimate, lower, upper] = selectedEndpoints.grid[outcome][population]
          store({ state: 'ready', points, endpoint: { estimate, lower, upper } })
        })
        .catch((error) =>
          store(
            isResultUnavailable(error)
              ? { state: 'unavailable', message: 'These results are unavailable.' }
              : { state: 'error', message: 'This result could not be loaded.' },
          ),
        )
    }
    return () => controller.abort()
  }, [releaseId, population, model, scale, selection, showMainResults, selectedEndpoints])

  useEffect(() => {
    const url = new URL(location.href)
    const route = routes[view]
    for (const key of resultParameters)
      if (!route.parameters.includes(key)) url.searchParams.delete(key)
    url.searchParams.set('view', route.id)
    if (view === 'Main results') {
      url.searchParams.set('model', model)
      url.searchParams.set('population', COHORT_SLUG[population])
      url.searchParams.set('scale', scale)
      url.searchParams.set('minutes', String(windowMinutes))
    }
    history.replaceState(null, '', url)
  }, [model, population, scale, windowMinutes, view])
  const pressureDomains = useMemo(() => {
    const domains = (['ARTm', 'ARTs', 'ARTd'] as const).map(
      (code) =>
        [
          code,
          curveDomain(
            (cards[code]?.points ?? []).filter((p) => Math.abs(p.time) <= windowMinutes),
            scale === 'changes',
          ),
        ] as const,
    )
    const valid = domains.filter(
      (pair): pair is readonly ['ARTm' | 'ARTs' | 'ARTd', CurveDomain] => pair[1] !== null,
    )
    if (!valid.length) return {}
    if (scale === 'changes') {
      const shared = {
        min: Math.min(...valid.map(([, d]) => d.min)),
        max: Math.max(...valid.map(([, d]) => d.max)),
      }
      return Object.fromEntries(valid.map(([code]) => [code, shared])) as Partial<
        Record<Outcome, CurveDomain>
      >
    }
    const span = Math.max(...valid.map(([, d]) => d.max - d.min))
    return Object.fromEntries(
      valid.map(([code, d]) => [
        code,
        { min: (d.min + d.max - span) / 2, max: (d.min + d.max + span) / 2 },
      ]),
    ) as Partial<Record<Outcome, CurveDomain>>
  }, [cards, windowMinutes, scale])

  const exportReady = Boolean(
    releaseId && !releaseError && ordered.every((code) => cards[code]?.state === 'ready'),
  )
  function exportTrajectories() {
    if (!releaseId || !exportReady) throw new Error('FIGURE_SCOPE_NOT_READY')
    return trajectorySummarySvg({
      releaseId,
      population,
      model,
      scale,
      windowMinutes,
      panels: ordered.map((outcome) => {
        const card = cards[outcome]
        if (!card?.points || !card.endpoint) throw new Error('Trajectory is unavailable')
        return {
          outcome,
          points: card.points,
          contrast: card.endpoint,
          domain: pressureDomains[outcome],
        }
      }),
    })
  }

  const displayProps = { displayReleaseId: releaseId, releaseError }
  const viewIndex = views.indexOf(view)
  const navigateTo = (name: (typeof views)[number]) => {
    if (name === view) return
    const url = new URL(location.href)
    for (const key of resultParameters) url.searchParams.delete(key)
    url.searchParams.set('view', routes[name].id)
    history.pushState(null, '', url)
    if (name === 'Main results') {
      setModel('FULL')
      setPopulation('PRIMARY')
      setScale('changes')
      setWindowMinutes(720)
    }
    setPublicationView((value) => value + 1)
    setView(name)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  return (
    <>
      <a className="skip" href="#content">
        Skip to results
      </a>
      <header className="publication-header">
        <div className="brand">
          <span className="brand-wordmark">SCANDAT</span>{' '}
          <span className="brand-group">Research Group</span>
        </div>
        <h1 className="paper-title">
          Physiological trajectories surrounding red blood cell transfusion in intensive care
          patients and their associations with blood unit characteristics
        </h1>
      </header>
      <main
        id="content"
        className={view === 'Blood unit comparisons' ? 'component-results' : undefined}
      >
        <nav aria-label="Result views">
          {views.map((name) => (
            <button
              key={name}
              aria-current={view === name ? 'page' : undefined}
              onClick={() => navigateTo(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        {view === 'Main results' ? (
          <Fragment key={publicationView}>
            <div className="figure-heading">
              <div>
                <h2>{trajectoryTitle(releaseId, population, model, scale, windowMinutes)}</h2>
                <p>
                  {MODEL_LABELS[model]} &middot; {POPULATION_LABELS[population]} &middot;{' '}
                  {timeWindowLabel(windowMinutes)} before and after transfusion
                </p>
              </div>
              <div className="figure-heading-actions">
                <span>Transfusion starts at 0 h</span>
                <SummaryDownload
                  ready
                  createSvg={exportTrajectories}
                  filename={`trajectories-${scale}-${COHORT_SLUG[population]}-${MODEL_FILENAME[model]}-plus-minus-${windowMinutes / 60}h.svg`}
                  disabled={!exportReady}
                />
              </div>
            </div>
            <OptionsPanel
              className="main-options"
              label="Model, cohort and display options"
              summary={`${MODEL_LABELS[model]}; ${POPULATION_LABELS[population]}; ${scale === 'changes' ? 'change from 1 h before' : 'absolute levels'}; ${timeWindowLabel(windowMinutes)} before and after transfusion`}
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
                <fieldset>
                  <legend>Display</legend>
                  <div className="segmented">
                    {(['changes', 'levels'] as const).map((code) => (
                      <button
                        key={code}
                        aria-pressed={scale === code}
                        onClick={() => setScale(code)}
                      >
                        {code === 'levels' ? 'Absolute level' : 'Change from −1 h'}
                      </button>
                    ))}
                  </div>
                </fieldset>
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
              {(model !== 'FULL' ||
                population !== 'PRIMARY' ||
                scale !== 'changes' ||
                windowMinutes !== 720) && (
                <button
                  className="text-button"
                  onClick={() => {
                    setModel('FULL')
                    setPopulation('PRIMARY')
                    setScale('changes')
                    setWindowMinutes(720)
                  }}
                >
                  Reset to defaults
                </button>
              )}
            </OptionsPanel>
            {releaseError ? (
              <div className="error" role="alert">
                <h3>Results could not be loaded</h3>
                <button onClick={() => setRetry((value) => value + 1)}>Try again</button>
              </div>
            ) : (
              <div
                className="panel-grid trajectory-grid publication-figure-grid"
                aria-label="Seven outcomes and figure key"
              >
                {ordered.map((code) => {
                  const meta = OUTCOME_META[code],
                    card = cards[code]
                  const unit = scale === 'changes' ? meta.changeUnit : meta.unit
                  return (
                    <section
                      className="trajectory-card"
                      aria-labelledby={`title-${code}`}
                      key={code}
                    >
                      <div className="card-title">
                        <div>
                          <h3 id={`title-${code}`}>{meta.name}</h3>
                          <p>{unit}</p>
                        </div>
                        <span className="outcome-code">{meta.shortName}</span>
                      </div>
                      {card?.state === 'ready' && card.points && releaseId ? (
                        <>
                          <TrajectoryChart
                            key={`${selection}/${code}`}
                            points={card.points}
                            title={meta.name}
                            unit={unit}
                            windowMinutes={windowMinutes}
                            color={meta.color}
                            domain={pressureDomains[code]}
                            change={scale === 'changes'}
                            downloadContext={{ population, model, outcome: code }}
                            footer={
                              <div className="endpoint-summary">
                                <div className="endpoint">
                                  <span>1 h after minus 1 h before</span>
                                  <strong>
                                    {formatValue(card.endpoint?.estimate ?? null)}{' '}
                                    <small>{meta.changeUnit}</small>
                                  </strong>
                                </div>
                                <div className="endpoint-ci">
                                  {card.endpoint?.lower !== null &&
                                  card.endpoint?.lower !== undefined &&
                                  card.endpoint.upper !== null
                                    ? `95% CI ${formatValue(card.endpoint.lower)} to ${formatValue(card.endpoint.upper)}`
                                    : 'Confidence interval unavailable'}
                                </div>
                              </div>
                            }
                          />
                        </>
                      ) : (
                        <div className="card-empty" role="status">
                          {card?.message ?? 'Loading trajectory...'}
                        </div>
                      )}
                    </section>
                  )
                })}
                <section className="figure-key" aria-labelledby="trajectory-key-title">
                  <h3 id="trajectory-key-title">How to read the figure</h3>
                  <ul className="trajectory-legend" aria-label="Figure symbols">
                    <li>
                      <i className="legend-line" aria-hidden="true" />
                      {scale === 'levels' ? 'Adjusted predicted mean' : 'Adjusted predicted change'}
                    </li>
                    <li>
                      <i className="legend-band" aria-hidden="true" />
                      Pointwise 95% CI
                    </li>
                    <li>
                      <i className="legend-transfusion" aria-hidden="true" />
                      Transfusion start (0 h)
                    </li>
                    <li>
                      <i className="legend-points" aria-hidden="true" />
                      Values at −1 and +1 h
                    </li>
                  </ul>
                  <p>
                    The curves span {timeWindowLabel(windowMinutes)} before and after transfusion.{' '}
                    {scale === 'levels'
                      ? 'Predictions are for the model’s reference profile.'
                      : 'Change is relative to the predicted value one hour before transfusion.'}
                  </p>
                  <p>
                    Each panel gives the predicted change from 1 hour before to 1 hour after
                    transfusion start and its 95% confidence interval.
                  </p>
                  <p>
                    Changes in fraction of inspired oxygen and peripheral oxygen saturation are in
                    percentage points.
                  </p>
                </section>
              </div>
            )}
            {releaseId && !releaseError && (
              <MainResultsTable
                key={`${releaseId}/${population}/${retry}`}
                cohort={population}
                releaseId={releaseId}
                endpoints={endpointResults}
                onRetry={() => setRetry((value) => value + 1)}
              />
            )}
            <details className="method-note">
              <summary>Cohort, adjustment and interpretation</summary>
              <p>{POPULATION_NOTES[population]}</p>
              <p>
                The base model adjusts for recipient age and sex, ICU ward, time from admission to
                transfusion start and the number of earlier red blood cell units in that admission.
              </p>
              <p>{FULL_MODEL_NOTE}</p>
              <p>{REFERENCE_PROFILE_NOTE}</p>
              <p>
                Shading shows pointwise 95% confidence intervals for{' '}
                {scale === 'levels' ? 'the predicted mean' : 'the predicted change'}. These describe
                uncertainty at each time point, not for the whole curve or an individual patient’s
                response.
              </p>
              <p>
                Values are displayed in the recorded clinical units without rescaling. Changes in
                fraction of inspired oxygen and peripheral oxygen saturation are expressed in
                percentage points. Inspect values by hovering over the curve or using the arrow keys
                after selecting it.
              </p>
            </details>
          </Fragment>
        ) : view === 'Blood unit comparisons' ? (
          <ComponentComparisons {...displayProps} key={publicationView} />
        ) : view === 'Sensitivity analyses' ? (
          <SensitivityAnalyses {...displayProps} />
        ) : view === 'Study characteristics' ? (
          <StudyPopulation {...displayProps} />
        ) : (
          <ObservedPatterns displayReleaseId={releaseId} releaseError={releaseError} />
        )}
        <nav className="section-navigation" aria-label="Continue through results">
          {viewIndex > 0 ? (
            <button onClick={() => navigateTo(views[viewIndex - 1]!)}>
              ← {views[viewIndex - 1]}
            </button>
          ) : (
            <span />
          )}
          {viewIndex < views.length - 1 && (
            <button onClick={() => navigateTo(views[viewIndex + 1]!)}>
              Next: {views[viewIndex + 1]} →
            </button>
          )}
        </nav>
      </main>
      <footer>
        <div className="brand">
          <span className="brand-wordmark">SCANDAT</span>{' '}
          <span className="brand-group">Research Group</span>
        </div>
        <div className="study-attribution">
          <p>Study by Lucas D. Ekström, Max Bell, Johan Mårtensson and Gustaf Edgren.</p>
          <p>
            The dashboard presents aggregate results. Individual clinical records are restricted.
          </p>
          <a href={methodsUrl}>Methods and code excerpts</a> ·{' '}
          <a href="https://github.com/SCANDAT/Publication-Dashboard/blob/main/LICENSE">
            Software license
          </a>{' '}
          · <a href="mailto:lucas.ekstrom@ki.se">Contact the corresponding author</a>
        </div>
      </footer>
    </>
  )
}
