import { useEffect, useState } from 'react'
import { POPULATIONS, type FitKey } from '../data/release'
import {
  MODEL_FILENAME,
  OUTCOME_META,
  POPULATION_LABELS,
  FULL_MODEL_NOTE,
  PANEL_ORDER,
  MODEL_LABELS,
} from '../data/display'
import { isResultUnavailable, readDisplay } from '../data/reader'
import { displayEndpoints } from '../data/mainDisplay'
import ForestPlot, { type ForestRow } from './ForestPlot'
import SummaryDownload from './SummaryDownload'
import OptionsPanel from './OptionsPanel'
import { sensitivitySummarySvg } from '../figures/summarySvg'
import './sensitivityLayout.css'

type Props = { releaseError: boolean; displayReleaseId?: string }
export default function SensitivityAnalyses({ releaseError, displayReleaseId }: Props) {
  const [model, setModel] = useState<FitKey['model']>(() =>
    new URLSearchParams(location.search).get('model') === 'BASE' ? 'BASE' : 'FULL',
  )
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('model', model)
    history.replaceState(null, '', url)
  }, [model])
  const selection = `${displayReleaseId}/${model}`
  const [loaded, setLoaded] = useState<{ selection: string; rows: Record<string, ForestRow> }>({
    selection: '',
    rows: {},
  })
  const rows = loaded.selection === selection ? loaded.rows : {}
  useEffect(() => {
    if (!displayReleaseId || releaseError) return
    const controller = new AbortController()
    setLoaded({ selection, rows: {} })
    const key = 'endpoints/' + model
    const storeGrid = (grid?: ReturnType<typeof displayEndpoints>, unavailableLabel?: string) => {
      if (controller.signal.aborted) return
      const complete: Record<string, ForestRow> = {}
      for (const outcome of PANEL_ORDER)
        for (const population of POPULATIONS) {
          const id = outcome + '/' + population
          const label = POPULATION_LABELS[population]
          const values = grid?.[outcome][population]
          complete[id] = values
            ? { id, label, estimate: values[0], lower: values[1], upper: values[2] }
            : { id, label, estimate: null, lower: null, upper: null, unavailableLabel }
        }
      setLoaded({ selection, rows: complete })
    }
    readDisplay(key, controller.signal)
      .then((value) => storeGrid(displayEndpoints(key, value)))
      .catch((error) =>
        storeGrid(
          undefined,
          isResultUnavailable(error) ? 'Result unavailable' : 'Result could not be loaded',
        ),
      )
    return () => controller.abort()
  }, [model, selection, displayReleaseId, releaseError])
  const exportReady = Boolean(
    displayReleaseId &&
      !releaseError &&
      PANEL_ORDER.every((outcome) =>
        POPULATIONS.every((population) => {
          const row = rows[outcome + '/' + population]
          return row && row.estimate !== null
        }),
      ),
  )
  function exportSensitivities() {
    if (!displayReleaseId || !exportReady) throw new Error('FIGURE_SCOPE_NOT_READY')
    return sensitivitySummarySvg({
      releaseId: displayReleaseId,
      model,
      panels: PANEL_ORDER.map((outcome) => ({
        outcome,
        rows: POPULATIONS.map((population) => {
          const row = rows[`${outcome}/${population}`]!
          return {
            population,
            estimate: row.estimate,
            lower: row.lower,
            upper: row.upper,
            unavailableLabel: row.unavailableLabel,
          }
        }),
      })),
    })
  }
  return (
    <section className="sensitivity-view" aria-labelledby="sensitivity-heading">
      <div className="view-heading">
        <div>
          <h2 id="sensitivity-heading">Sensitivity analyses</h2>
          <p>
            Predicted change from one hour before to one hour after transfusion start in each
            cohort.
          </p>
        </div>
        <div className="figure-heading-actions">
          <OptionsPanel
            className="sensitivity-options"
            label="Sensitivity model options"
            summary={MODEL_LABELS[model]}
          >
            <label className="compact-control">
              Model
              <select
                aria-label="Model"
                value={model}
                onChange={(event) => setModel(event.target.value as FitKey['model'])}
              >
                <option value="FULL">{MODEL_LABELS.FULL}</option>
                <option value="BASE">{MODEL_LABELS.BASE}</option>
              </select>
            </label>
          </OptionsPanel>
          <SummaryDownload
            ready
            createSvg={exportSensitivities}
            filename={`sensitivity-comparisons-${MODEL_FILENAME[model]}.svg`}
            disabled={!exportReady}
          />
        </div>
      </div>
      {releaseError ? (
        <div className="error" role="status">
          Results could not be loaded.
        </div>
      ) : (
        <div
          className="panel-grid sensitivity-grid publication-figure-grid"
          aria-label="Seven sensitivity outcomes and figure key"
        >
          {PANEL_ORDER.map((outcome) => {
            const meta = OUTCOME_META[outcome]
            return (
              <section
                className="trajectory-card"
                key={outcome}
                aria-labelledby={`sensitivity-${outcome}`}
              >
                <div className="card-title">
                  <div>
                    <h3 id={`sensitivity-${outcome}`}>{meta.name}</h3>
                    <p>{meta.changeUnit}</p>
                  </div>
                </div>
                <ForestPlot
                  alignColumns
                  showLegend={false}
                  context={`${MODEL_LABELS[model]}; predicted change from 1 h before to 1 h after transfusion start${outcome === 'FIO2' || outcome === 'SPO2' ? '; change in percentage points' : ''}`}
                  title={`${meta.name}: changes by cohort`}
                  rowHeading="Cohort"
                  unit={meta.changeUnit}
                  color={meta.color}
                  zeroLabel="no change"
                  rows={POPULATIONS.map(
                    (population) =>
                      rows[`${outcome}/${population}`] ?? {
                        id: population,
                        label: POPULATION_LABELS[population],
                        estimate: null,
                        lower: null,
                        upper: null,
                        unavailableLabel: 'Loading…',
                      },
                  )}
                />
              </section>
            )
          })}
          <section className="figure-key">
            <h3>Cohorts compared</h3>
            <ul className="trajectory-legend" aria-label="Sensitivity figure symbols">
              <li>
                <i className="legend-estimate" aria-hidden="true" />
                Predicted change, −1 to +1 h
              </li>
              <li>
                <i className="legend-interval" aria-hidden="true" />
                Pointwise 95% CI
              </li>
              <li>
                <i className="legend-transfusion" aria-hidden="true" />
                Zero: no change
              </li>
            </ul>
            <dl className="cohort-key">
              <dt>{POPULATION_LABELS.PRIMARY}</dt>
              <dd>
                No RBC start was recorded in the preceding 12 hours. A later transfusion was
                allowed.
              </dd>
              <dt>{POPULATION_LABELS.FIRST_EVENT}</dt>
              <dd>We selected the earliest eligible event for each patient.</dd>
              <dt>{POPULATION_LABELS.NO_FOLLOWING_UNIT_12H}</dt>
              <dd>
                We retained primary events with no further recorded RBC start in the next 12 hours.
              </dd>
            </dl>
            <p>Each cohort has its own model and prediction profile. Cohorts can overlap.</p>
            <p>FiO₂ and SpO₂ changes are expressed in percentage points.</p>
          </section>
        </div>
      )}
      <details className="method-note">
        <summary>Cohorts and interpretation</summary>
        <p>
          We applied each restriction separately to the primary cohort. In the first analysis, if
          the earliest event lacked the data required for a model, we did not substitute a later
          event. In the second, a further start within 12 hours excluded the earlier event. The
          later start itself could not serve as a new index event. The full 12-hour interval had to
          fall within the period covered by the transfusion extract. Units starting simultaneously
          formed one event.
        </p>
        <p>
          The confidence intervals describe the predicted change within each cohort. Direct
          differences between cohorts were not tested.
        </p>
        {model === 'FULL' && <p>{FULL_MODEL_NOTE}</p>}
      </details>
    </section>
  )
}
