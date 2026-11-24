import { useEffect, useState } from 'react'
import { formatValue } from './trajectoryGeometry'
import { cohortPhrase, OUTCOME_META, PANEL_ORDER } from '../data/display'
import { isManuscriptRelease } from '../data/displayManifest.mjs'
import { cohortTableKey, displayCohortTable, displayEndpoints } from '../data/mainDisplay'
import { isResultUnavailable, readDisplay } from '../data/reader'
import type { FitKey } from '../data/release'
import './mainResultsTable.css'

type Grid = ReturnType<typeof displayEndpoints>
type CohortRows = ReturnType<typeof displayCohortTable>
export type EndpointResult = { grid: Grid } | { state: 'unavailable' | 'error' }
type Endpoints = Partial<Record<FitKey['model'], EndpointResult>>
type TableResult =
  | { state: 'ready'; rows: CohortRows }
  | { state: 'loading' | 'unavailable' | 'error' }

const count = new Intl.NumberFormat('en-GB')
const meanSD = ([mean, sd]: readonly [number, number]) => (
  <>
    {formatValue(mean, 1)}{' '}
    <span className="estimate-detail">({formatValue(sd, 1)})</span>
  </>
)
const changeCI = ([estimate, lower, upper]: readonly [number, number, number]) => (
  <>
    {formatValue(estimate, 2)}{' '}
    <span className="estimate-detail">
      ({formatValue(lower, 2)} to {formatValue(upper, 2)})
    </span>
  </>
)

function modelCell(
  result: EndpointResult | undefined,
  outcome: FitKey['outcome'],
  cohort: FitKey['population'],
) {
  if (!result || 'state' in result) return '—'
  return changeCI(result.grid[outcome][cohort])
}

export default function MainResultsTable({
  cohort,
  releaseId,
  endpoints,
  onRetry,
}: {
  cohort: FitKey['population']
  releaseId: string
  endpoints: Endpoints
  onRetry: () => void
}) {
  const [result, setResult] = useState<TableResult>({ state: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    const key = cohortTableKey(cohort)
    readDisplay(key, controller.signal)
      .then((value) => displayCohortTable(key, value))
      .then((rows) => {
        if (!controller.signal.aborted) setResult({ state: 'ready', rows })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ state: isResultUnavailable(error) ? 'unavailable' : 'error' })
      })
    return () => controller.abort()
  }, [cohort, releaseId])

  const rows = result.state === 'ready' ? result.rows : undefined
  const loading = result.state === 'loading' || !endpoints.BASE || !endpoints.FULL
  const modelError = Object.values(endpoints).some(
    (endpoint) => 'state' in endpoint && endpoint.state === 'error',
  )
  const modelUnavailable = Object.values(endpoints).some(
    (endpoint) => 'state' in endpoint && endpoint.state === 'unavailable',
  )
  const failed = result.state === 'error' || modelError
  const title = `Physiological changes from 1 hour before to 1 hour after red blood cell transfusion start ${cohortPhrase(cohort)}`

  return (
    <section className="main-results-table" aria-labelledby="main-table-title">
      <h2 id="main-table-title">
        {isManuscriptRelease(releaseId) && cohort === 'PRIMARY' && 'Table 2. '}
        {title}
      </h2>
      {(loading || failed || modelUnavailable || result.state === 'unavailable') && (
        <div className="result-table-status" role="status">
          {loading && <p>Loading results for this cohort…</p>}
          {result.state === 'unavailable' && (
            <p>Paired observations and contributor counts are unavailable for this cohort.</p>
          )}
          {result.state === 'error' && (
            <p>Paired observations and contributor counts could not be loaded.</p>
          )}
          {modelUnavailable && <p>Some model estimates are unavailable.</p>}
          {modelError && <p>Some model estimates could not be loaded.</p>}
          {failed && (
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
      <div
        className="table-scroll"
        role="region"
        tabIndex={0}
        aria-labelledby="main-table-title"
        aria-busy={loading}
      >
        <table className="outcome-results" aria-describedby="main-table-notes">
          <colgroup span={1} />
          <colgroup span={5} />
          <colgroup span={5} />
          <thead>
            <tr>
              <th rowSpan={2} scope="col">
                Outcome
              </th>
              <th colSpan={5} scope="colgroup">
                Observed paired comparison
              </th>
              <th colSpan={5} scope="colgroup">
                Adjusted models
              </th>
            </tr>
            <tr>
              <th scope="col">
                −1 h<span>Mean (SD)</span>
              </th>
              <th scope="col">
                +1 h<span>Mean (SD)</span>
              </th>
              <th scope="col">
                Paired change<span>(95% CI)</span>
              </th>
              <th scope="col">Patients</th>
              <th scope="col">Events</th>
              <th className="model-start" scope="col">
                BASE change<span>(95% CI)</span>
              </th>
              <th scope="col">
                FULL change<span>(95% CI)</span>
              </th>
              <th scope="col">Patients</th>
              <th scope="col">Events</th>
              <th scope="col">Measurement records</th>
            </tr>
          </thead>
          <tbody>
            {PANEL_ORDER.map((code) => {
              const meta = OUTCOME_META[code]
              const row = rows?.[code]
              return (
                <tr key={code}>
                  <th scope="row">
                    {meta.name}{' '}
                    <span className="outcome-unit">
                      ({meta.shortName}), {meta.unit}
                    </span>
                  </th>
                  <td>{row ? meanSD(row.before) : '—'}</td>
                  <td>{row ? meanSD(row.after) : '—'}</td>
                  <td>{row ? changeCI(row.change) : '—'}</td>
                  <td>{row ? count.format(row.observedPatients) : '—'}</td>
                  <td>{row ? count.format(row.observedEvents) : '—'}</td>
                  <td className="model-start">{modelCell(endpoints.BASE, code, cohort)}</td>
                  <td>{modelCell(endpoints.FULL, code, cohort)}</td>
                  <td>{row ? count.format(row.modelPatients) : '—'}</td>
                  <td>{row ? count.format(row.modelEvents) : '—'}</td>
                  <td>{row ? count.format(row.modelMeasurements) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div id="main-table-notes" className="result-table-notes">
        <p className="result-table-note">
          Observed means and standard deviations (SDs) summarize event means at 55–65 minutes before
          and 55–65 minutes after transfusion start. Each event with readings in both windows
          contributes equally. Observed change is the mean paired difference (after minus before).
        </p>
        <p className="result-table-note">
          Model change is the prediction at +1 hour minus that at −1 hour for a fixed covariate
          profile. BASE adjusted for recipient age and sex, ICU ward, time from ICU admission to
          transfusion start and earlier red blood cell units in that admission. FULL added
          crystalloid, noradrenaline and sedative/analgesic summaries for the 1 and 24 hours before
          each measurement.
        </p>
        <p className="result-table-note">
          Pointwise 95% confidence intervals (CIs) account for repeated observations within
          patients. FiO₂ and SpO₂ changes are in percentage points. ICU, intensive care unit. BASE
          and FULL counts were identical for each outcome. A reading was counted once in each
          eligible event window to which it contributed.
        </p>
      </div>
    </section>
  )
}
