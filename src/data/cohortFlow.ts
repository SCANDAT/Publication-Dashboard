import type { StudyDisplay } from './studyDisplay'

const criteria = [
  [
    'Patients with a candidate RBC transfusion event',
    'No candidate transfusion started during a recorded ICU stay.',
  ],
  [
    'At least one start during a recorded ICU admission',
    'We could not assign a transfusion start to a single ICU admission or establish how many earlier RBC units were given in that admission.',
  ],
] as const
const cohorts = [
  [
    'First eligible event per patient',
    'A later event never replaced a first event that lacked data for a model.',
  ],
  [
    'No further recorded RBC transfusion within 12 hours',
    'Records covered all 12 hours after the index start, with no further RBC start.',
  ],
] as const

function check(ok: unknown): asserts ok {
  if (!ok) throw new Error('Invalid cohort flow')
}

function fields(
  value: unknown,
  names: readonly string[],
): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value))
  check(
    Object.keys(value).length === names.length &&
      names.every((name) => Object.prototype.hasOwnProperty.call(value, name)),
  )
}

function count(value: unknown): number {
  check(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
  )
  return value
}

function countPair(value: unknown): readonly [number, number] {
  check(Array.isArray(value) && value.length === 2)
  return [count(value[0]), count(value[1])]
}

export function displayCohortFlow(value: unknown) {
  fields(value, ['key', 'selection', 'primary', 'sensitivity'])
  check(value.key === 'figures/cohort-flow')
  const selectionRows = value.selection
  const sensitivityRows = value.sensitivity
  check(Array.isArray(selectionRows) && selectionRows.length === criteria.length)
  check(Array.isArray(sensitivityRows) && sensitivityRows.length === cohorts.length)
  fields(value.primary, ['patients', 'admissions', 'events', 'units'])
  const primary = {
    patients: count(value.primary.patients),
    admissions: count(value.primary.admissions),
    events: count(value.primary.events),
    units: count(value.primary.units),
  }
  check(
    primary.patients > 0 &&
      primary.patients <= primary.admissions &&
      primary.admissions <= primary.events &&
      primary.events <= primary.units,
  )
  const selection = criteria.map(([criterion, reason], i) => {
    const [patients, lost] = countPair(selectionRows[i])
    return { criterion, patients, excluded: { patients: lost, reason } }
  })
  for (const [i, step] of selection.entries()) {
    check(
      step.patients - step.excluded.patients === (selection[i + 1]?.patients ?? primary.patients),
    )
  }
  const sensitivity = cohorts.map(([name, rule], i) => {
    const [patients, events] = countPair(sensitivityRows[i])
    check(patients <= primary.patients && patients <= events && events <= primary.events)
    if (i === 0) check(patients === primary.patients && events === patients)
    return { name, rule, patients, events }
  })
  return { selection, primary, sensitivity }
}

export function checkFlowStudyCounts(
  flow: ReturnType<typeof displayCohortFlow>,
  primary: StudyDisplay['counts'],
  first: StudyDisplay['counts'],
  noFurther: StudyDisplay['counts'],
) {
  check(
    flow.primary.patients === primary.PERSONS &&
      flow.primary.admissions === primary.ICU_ADMISSIONS &&
      flow.primary.events === primary.INDEX_EVENTS &&
      flow.primary.units === primary.LINKED_PHYSICAL_UNITS,
  )
  for (const [i, counts] of [first, noFurther].entries()) {
    const cohort = flow.sensitivity[i]!
    check(cohort.patients === counts.PERSONS && cohort.events === counts.INDEX_EVENTS)
  }
}
