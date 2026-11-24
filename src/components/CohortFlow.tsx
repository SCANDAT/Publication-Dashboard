import { useEffect, useId, useState } from 'react'
import { displayCohortFlow } from '../data/cohortFlow'
import { isResultUnavailable, readDisplay } from '../data/reader'
import './cohortFlow.css'

const counts = new Intl.NumberFormat('en-US')
const title =
  'Figure S1. Selection of the primary cohort and the two overlapping sensitivity cohorts'
type FlowState =
  | { state: 'loading' | 'unavailable' | 'error' }
  | { state: 'ready'; flow: ReturnType<typeof displayCohortFlow> }

export default function CohortFlow() {
  const headingId = useId()
  const [result, setResult] = useState<FlowState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    readDisplay('figures/cohort-flow', controller.signal)
      .then(displayCohortFlow)
      .then((flow) => {
        if (!controller.signal.aborted) setResult({ state: 'ready', flow })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setResult({ state: isResultUnavailable(reason) ? 'unavailable' : 'error' })
      })
    return () => controller.abort()
  }, [attempt])

  if (result.state !== 'ready') {
    return (
      <section className="cohort-flow" aria-labelledby={headingId}>
        <h3 id={headingId}>{title}</h3>
        {result.state === 'loading' && <p role="status">Loading the cohort flow diagram…</p>}
        {result.state === 'unavailable' && (
          <p role="status">The cohort flow diagram is unavailable.</p>
        )}
        {result.state === 'error' && (
          <>
            <p role="status">The cohort flow diagram could not be loaded.</p>
            <button
              type="button"
              onClick={() => {
                setResult({ state: 'loading' })
                setAttempt((value) => value + 1)
              }}
            >
              Retry cohort flow diagram
            </button>
          </>
        )}
      </section>
    )
  }

  const { flow } = result
  const steps = [
    ...flow.selection,
    {
      criterion: 'Index admission and number of earlier RBC units established',
      patients: flow.primary.patients,
      excluded: null,
    },
  ]
  const primaryTotals = [
    ['Patients', flow.primary.patients],
    ['ICU admissions', flow.primary.admissions],
    ['Eligible transfusion events', flow.primary.events],
    ['RBC units', flow.primary.units],
  ] as const
  return (
    <figure className="cohort-flow" aria-labelledby={headingId}>
      <figcaption>
        <h3 id={headingId}>{title}</h3>
        <p>
          Patients with a recorded red blood cell (RBC) transfusion and an intensive care unit (ICU)
          physiological measurement within 12 hours before or after transfusion start.
        </p>
      </figcaption>

      <ol className="cohort-flow-steps" aria-label="Patient selection" role="list">
        {steps.map((step) => (
          <li key={step.criterion}>
            <div className="cohort-flow-node">
              <span>{step.criterion}</span>
              <strong>{counts.format(step.patients)} patients</strong>
              {step.excluded && <span className="cohort-flow-connector" aria-hidden="true" />}
            </div>
            {step.excluded && (
              <p className="cohort-flow-exclusion">
                <strong>
                  Excluded {counts.format(step.excluded.patients)}{' '}
                  {step.excluded.patients === 1 ? 'patient' : 'patients'}
                </strong>
                <span>{step.excluded.reason}</span>
              </p>
            )}
          </li>
        ))}
      </ol>

      <div className="cohort-flow-primary">
        <h4>Primary cohort</h4>
        <p>
          Each event required 12 hours without a recorded RBC start beforehand. A further start in
          the next 12 hours was allowed.
        </p>
        <dl>
          {primaryTotals.map(([label, total]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{counts.format(total)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="cohort-flow-sensitivity">
        <h4>Sensitivity analyses</h4>
        <p>
          The two restrictions were applied separately. Patients and events can appear in both
          cohorts.
        </p>
        <div className="cohort-flow-branches">
          {flow.sensitivity.map((cohort) => (
            <section key={cohort.name} className="cohort-flow-branch">
              <h5>{cohort.name}</h5>
              <p>{cohort.rule}</p>
              <p className="cohort-flow-branch-count">
                <strong>{counts.format(cohort.patients)}</strong> patients and{' '}
                <strong>{counts.format(cohort.events)}</strong> events
              </p>
            </section>
          ))}
        </div>
      </div>

      <p className="cohort-flow-notes">
        Each exclusion counts patients with no eligible event remaining at that step. RBC units
        started simultaneously in the same patient form one event. Model-specific counts depend on
        data availability.
      </p>
    </figure>
  )
}
