import { useEffect, useState } from 'react'
import './studyPopulation.css'
import CohortFlow from './CohortFlow'
import CohortSelect from './CohortSelect'
import { POPULATIONS, type FitKey } from '../data/release'
import {
  formatUnitRange,
  COHORT_SLUG,
  readSelection,
  POPULATION_LABELS,
  POPULATION_NOTES,
  FULL_MODEL_NOTE,
  PRIMARY_CHANGE_NOTE,
  REFERENCE_PROFILE_NOTE,
  PARITY_NOTE,
} from '../data/display'
import { isManuscriptRelease } from '../data/displayManifest.mjs'
import { isResultUnavailable, readDisplay } from '../data/reader'
import {
  studyRowCode,
  validateStudyDisplay,
  type StudyDisplay,
} from '../data/studyDisplay'
import {
  COUNT_LABELS,
  UNIT_FACTOR_LABELS,
  value,
  type CountUnit,
  type Numeric,
} from '../data/studyReports'

interface Props {
  releaseError: boolean
  displayReleaseId?: string
}

function CountHeaders() {
  return (
    <>
      <th scope="col" className="summary-unit">n</th>
      <th scope="col" className="summary-unit">(%)</th>
    </>
  )
}

function SummarySection({ label, unit }: { label: string; unit?: string }) {
  return (
    <tr className="table-section-row">
      <th scope="rowgroup">{label}</th>
      {unit ? (
        <th scope="colgroup" colSpan={2} className="summary-unit">{unit}</th>
      ) : (
        <CountHeaders />
      )}
    </tr>
  )
}
function SummaryColumns() {
  return (
    <>
      <colgroup>
        <col />
      </colgroup>
      <colgroup>
        <col className="study-number-column" />
        <col className="study-bracket-column" />
      </colgroup>
    </>
  )
}
function SummaryCells({
  main,
  bracket,
  digits = 1,
  status,
  annotation,
}: {
  main: Numeric
  bracket?: readonly [Numeric] | readonly [Numeric, Numeric]
  digits?: number
  status?: string
  annotation?: string
}) {
  return (
    <>
      <td className={`summary-number${main === null || status ? ' summary-text' : ''}`}>
        {status ?? value(main, digits)}
        {bracket || annotation ? ' ' : null}
      </td>
      <td className="summary-parenthesis">
        {bracket && !status ? <>({bracket.map((item) => value(item)).join(' to ')})</> : null}
        {annotation && <span className="category-note">{annotation}</span>}
      </td>
    </>
  )
}

export default function StudyPopulation({ releaseError, displayReleaseId }: Props) {
  const [population, setPopulation] = useState<FitKey['population']>(() => {
    return (
      readSelection(
        new URLSearchParams(location.search),
        'population',
        POPULATIONS,
        (code) => COHORT_SLUG[code],
      ) ?? 'PRIMARY'
    )
  })
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('population', COHORT_SLUG[population])
    history.replaceState(null, '', url)
  }, [population])
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    state: 'ready' | 'error' | 'unavailable'
    display?: StudyDisplay
  } | null>(null)
  const selection = `${displayReleaseId}/${population}`
  const current = loaded?.key === selection ? loaded : null
  useEffect(() => {
    if (!displayReleaseId || releaseError) return
    const key = `study/${population}`,
      controller = new AbortController()
    setLoaded(null)
    readDisplay(key, controller.signal)
      .then((raw) => validateStudyDisplay(key, raw))
      .then((display) => {
        if (!controller.signal.aborted) setLoaded({ key: selection, state: 'ready', display })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            key: selection,
            state: isResultUnavailable(reason) ? 'unavailable' : 'error',
          })
      })
    return () => controller.abort()
  }, [displayReleaseId, releaseError, population, selection, retry])
  const data = current?.display
  const unknownSexRows = data?.sex.filter(([label]) => label.startsWith('Unknown'))
  const unitGroups = ['DonorHb', 'Storage', 'DonationWeekday', 'DonorSex', 'DonorParity'].flatMap(
    (factor) => data?.units.filter((group) => group.factor === factor) ?? [],
  )
  const parity = data?.units.find((group) => group.factor === 'DonorParity')
  return (
    <section className="study-population" aria-labelledby="population-heading">
      <div className="figure-heading">
        <div>
          <h2 id="population-heading">
            {isManuscriptRelease(displayReleaseId) && population === 'PRIMARY'
              ? 'Table 1. Patient and blood unit characteristics in the primary cohort'
              : 'Study characteristics'}
          </h2>
          <p>Patient characteristics and the RBC units included in the analysis.</p>
        </div>
      </div>
      <div className="controls population-controls">
        <CohortSelect label="Cohort" value={population} onChange={setPopulation} />
      </div>
      <p className="report-note">{POPULATION_NOTES[population]}</p>
      {releaseError ? (
        <div className="error" role="alert">
          The cohort summaries could not be loaded.
        </div>
      ) : current?.state === 'unavailable' ? (
        <div className="report-empty" role="status">
          The selected cohort summaries are unavailable.
        </div>
      ) : current?.state === 'error' ? (
        <div className="error" role="alert">
          <p>The cohort summaries could not be loaded.</p>
          <button onClick={() => setRetry((previous) => previous + 1)}>Try again</button>
        </div>
      ) : !data ? (
        <div className="report-empty" role="status">
          Loading cohort summaries...
        </div>
      ) : (
        <>
          <p className="table-scroll-hint">
            Scroll horizontally within a table to see all columns.
          </p>
          <div className="population-summary">
            {(Object.keys(COUNT_LABELS) as CountUnit[]).map((unit) => (
              <div className="summary-card" key={unit}>
                <span>{COUNT_LABELS[unit]}</span>
                <strong>{value(data.counts[unit], 0)}</strong>
              </div>
            ))}
          </div>
          <p className="report-note">
            Patient characteristics describe each patient at their first eligible event in this
            cohort. Unit characteristics include all RBC units linked to eligible events.{' '}
            {population === 'PRIMARY'
              ? 'Table 2 gives the numbers contributing to each primary-cohort model.'
              : 'Table S2 gives the numbers contributing to each outcome model in this cohort.'}
          </p>
          <div className="study-tables">
            <section
              className="report-section study-table-section"
              aria-labelledby="patient-characteristics"
            >
              <h3 id="patient-characteristics">Patient characteristics</h3>
              <p className="study-table-subtitle">
                {POPULATION_LABELS[population]} &middot; {value(data.counts.PERSONS, 0)} patients
              </p>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Patient characteristics table"
              >
                <table className="data-table publication-table">
                  <caption>Characteristics at the first eligible event</caption>
                  <SummaryColumns />
                  <thead className="study-column-definitions">
                    <tr>
                      <th scope="col">Characteristic</th>
                      <th scope="colgroup" colSpan={2} className="summary-heading">
                        Summary
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <SummarySection label="Recipient sex" />
                    {data.sex.map(([label, count, percent]) => (
                      <tr key={label}>
                        <th scope="row">
                          {unknownSexRows?.length === 1 && label.startsWith('Unknown')
                            ? 'Unknown'
                            : label}
                        </th>
                        <SummaryCells main={count} bracket={[percent]} digits={0} />
                      </tr>
                    ))}
                    <SummarySection label="Age at first eligible event" unit="Years" />
                    <tr>
                      <th scope="row">Mean (SD)</th>
                      <SummaryCells main={data.age.mean[0]} bracket={[data.age.mean[1]]} />
                    </tr>
                    <tr>
                      <th scope="row">Median (IQR)</th>
                      <SummaryCells
                        main={data.age.median[0]}
                        bracket={[data.age.median[1], data.age.median[2]]}
                      />
                    </tr>
                    <SummarySection label="Age group" />
                    {data.ageBands === null ? (
                      <tr>
                        <th scope="row">Age groups</th>
                        <SummaryCells main={null} />
                      </tr>
                    ) : (
                      data.ageBands.map(([label, count, percent]) => (
                        <tr key={label}>
                          <th scope="row">{label}</th>
                          <SummaryCells main={count} bracket={[percent]} digits={0} />
                        </tr>
                      ))
                    )}
                    <SummarySection label="Blood units at eligible events per patient" />
                    {data.unitsPerPatient.length === 0 ? (
                      <tr>
                        <th scope="row">Units per patient</th>
                        <SummaryCells main={null} />
                      </tr>
                    ) : (
                      data.unitsPerPatient.map(([label, count, percent]) => (
                        <tr key={label}>
                          <th scope="row">{label}</th>
                          <SummaryCells main={count} bracket={[percent]} digits={0} />
                        </tr>
                      ))
                    )}
                    <SummarySection label="SAPS 3 at first eligible event" unit="Points" />
                    <tr>
                      <th scope="row">Mean (SD)</th>
                      <SummaryCells
                        main={data.saps.mean?.[0] ?? null}
                        bracket={[data.saps.mean?.[1] ?? null]}
                        status={data.saps.mean === null ? 'Not requested' : undefined}
                      />
                    </tr>
                    <tr>
                      <th scope="row">Median (IQR)</th>
                      <SummaryCells
                        main={data.saps.median?.[0] ?? null}
                        bracket={[data.saps.median?.[1] ?? null, data.saps.median?.[2] ?? null]}
                        status={data.saps.median === null ? 'Not requested' : undefined}
                      />
                    </tr>
                    <SummarySection label="SAPS 3 Score availability" />
                    <tr>
                      <th scope="row">Available numeric score</th>
                      <SummaryCells
                        main={data.saps.available[0]}
                        bracket={[data.saps.available[1]]}
                        digits={0}
                      />
                    </tr>
                    {data.saps.missing !== null && (
                      <tr>
                        <th scope="row">Unknown</th>
                        <SummaryCells
                          main={data.saps.missing[0]}
                          bracket={[data.saps.missing[1]]}
                          digits={0}
                        />
                      </tr>
                    )}
                    <tr>
                      <th scope="row">Nonnumeric score</th>
                      <SummaryCells
                        main={data.saps.invalid[0]}
                        bracket={[data.saps.invalid[1]]}
                        digits={0}
                      />
                    </tr>
                    {data.saps.notRequested.length === 1 && (
                      <tr>
                        <th scope="row">Not requested, n</th>
                        <SummaryCells main={data.saps.notRequested[0]} digits={0} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="study-table-notes">
                <p>
                  Values are n (%) unless specified otherwise. Patient percentages use all{' '}
                  {value(data.counts.PERSONS, 0)} eligible patients as the denominator. Age was
                  available for {value(data.age.available, 0)} patients and missing for{' '}
                  {value(data.age.missing, 0)}. SD indicates standard deviation and IQR indicates
                  interquartile range.
                </p>
                {data.saps.allPopulationsComplete && (
                  <p className="saps-completeness-note">
                    All three cohorts had SAPS 3 entries for every patient. Some entries were
                    nonnumeric.
                  </p>
                )}
                <p>
                  Unit counts include RBC units linked to eligible events in this cohort. Units
                  started simultaneously in the same patient formed one event.
                </p>
                <p>
                  The SAPS 3 summaries include all numeric scores. The models did not adjust for
                  SAPS 3.
                </p>
              </div>
            </section>
            <section
              className="report-section study-table-section"
              aria-labelledby="unit-characteristics"
            >
              <h3 id="unit-characteristics">Blood unit characteristics</h3>
              <p className="study-table-subtitle">
                {value(data.counts.LINKED_PHYSICAL_UNITS, 0)} RBC units linked to eligible events
              </p>
              {data.units.length === 0 ? (
                <p className="report-empty">
                  No unit characteristics are available for this cohort.
                </p>
              ) : (
                <div className="study-component-tables">
                  {unitGroups.map((group) => (
                    <div className="study-unit-group" key={group.factor}>
                      <div
                        className="table-scroll"
                        tabIndex={0}
                        role="region"
                        aria-label={`${UNIT_FACTOR_LABELS[group.factor]} table`}
                      >
                        <table className="data-table publication-table">
                          <caption>
                            {UNIT_FACTOR_LABELS[group.factor]}: RBC units linked to eligible events
                          </caption>
                          <SummaryColumns />
                          <thead>
                            <tr>
                              <th scope="col">{UNIT_FACTOR_LABELS[group.factor]}</th>
                              <CountHeaders />
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map(([label, count, percent]) => {
                              const code = studyRowCode(group.factor, label)
                              return (
                                <tr key={code}>
                                  <th scope="row">
                                    {code === 'OTHER_SEX_GROUP' ? (
                                      <>
                                        Male or unclassified<sup>
                                          <a
                                            href="#donor-sex-note"
                                            aria-label="Footnote a on donor sex"
                                            onClick={(event) => {
                                              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                                              event.preventDefault()
                                              document.getElementById('donor-sex-note')?.focus()
                                            }}
                                          >
                                            a
                                          </a>
                                        </sup>
                                      </>
                                    ) : (
                                      formatUnitRange(label)
                                    )}
                                  </th>
                                  <SummaryCells main={count} bracket={[percent]} digits={0} />
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      {group.coverage && <p className="study-denominator">{group.coverage}</p>}
                    </div>
                  ))}
                </div>
              )}
              <div className="study-table-notes">
                <p>
                  Values are n (%). Percentages use all{' '}
                  {value(data.counts.LINKED_PHYSICAL_UNITS, 0)} RBC units linked to eligible events.{' '}
                  {parity && (
                    <>
                      Parity percentages use female-donor units only (n ={' '}
                      {value(parity.parityDenominator ?? null, 0)}).{' '}
                    </>
                  )}
                  {PARITY_NOTE}
                </p>
                <p id="donor-sex-note" tabIndex={-1}>
                  <sup>a</sup> Units with missing or unclassifiable donor sex are grouped with
                  male-donor units to avoid reporting small counts. In the donor-sex models, an
                  event qualified for the male reference group only if every unit came from a
                  known male donor.
                </p>
                <p>
                  The donation weekday table combines Saturday and Sunday. The models include all
                  seven days. Reported comparisons cover Monday through Friday.
                </p>
              </div>
            </section>
          </div>
        </>
      )}
      {displayReleaseId && <CohortFlow key={displayReleaseId} />}
      <details className="report-section supporting-section">
        <summary>Analysis and definitions</summary>
        <h3>Transfusion events</h3>
        <p className="report-note">
          {POPULATION_NOTES.PRIMARY} RBC units started at the same time in the same patient formed
          one event.
        </p>
        <h3>Adjusted trajectories</h3>
        <p className="report-note">
          The models included a patient-specific random intercept and flexible time curves. BASE
          adjusted for age, recipient sex, ward, time from ICU admission to transfusion and earlier
          RBC units in the same admission.
        </p>
        <p className="report-note">{FULL_MODEL_NOTE}</p>
        <p className="report-note">
          Each model included only measurement records with an observed outcome and complete data
          for its covariates. Missing model variables were not imputed, and no physiological cutoffs
          were applied to exclude possible recording artifacts.
        </p>
        <h3>Change and uncertainty</h3>
        <p className="report-note">
          {PRIMARY_CHANGE_NOTE} For each blood unit characteristic, we compared the predicted
          two-hour changes between categories.
        </p>
        <p className="report-note">
          Confidence intervals accounted for repeated measurements within the same patient, using
          cluster-robust CR2 inference and contrast-specific degrees of freedom. Intervals are
          pointwise. Pairwise p values use Holm adjustment within each combination of
          characteristic, outcome, cohort and model.
        </p>
        <p className="report-note">
          The models for donation weekday included all seven days. Reported comparisons covered
          Monday through Friday. Where coefficients required correction, the estimated working
          covariance was held fixed. We recalculated the reported contrasts and their CR2
          uncertainty using the corrected coefficients.
        </p>
        <h3>Interpretation</h3>
        <p className="report-note">
          {REFERENCE_PROFILE_NOTE} These are observational associations.
        </p>
      </details>
    </section>
  )
}
