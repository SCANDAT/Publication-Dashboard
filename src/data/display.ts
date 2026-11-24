import { FACTORS, MODELS, OUTCOMES, POPULATIONS, type FitKey } from './release'
import { isManuscriptRelease } from './displayManifest.mjs'
import figureStyle from './figureStyle.json'
import categoryLabels from './categoryLabels.json'

if (
  figureStyle.panels.length !== OUTCOMES.length ||
  OUTCOMES.some((code) => figureStyle.panels.filter((panel) => panel.code === code).length !== 1)
)
  throw new Error('FIGURE_PANEL_REGISTRY')

export const PANEL_ORDER = figureStyle.panels.map(
  (panel) => panel.code,
) as readonly (typeof OUTCOMES)[number][]

/** Clinical outcome names, display units and chart labels. */
export interface OutcomeMeta {
  readonly name: string
  readonly shortName: string
  readonly unit: string
  readonly changeUnit: string
  readonly color: string
  readonly unitNote?: string
}

const RECORDED_UNIT_NOTE = 'Levels use the recorded clinical units.'

export const OUTCOME_META = Object.fromEntries(
  figureStyle.panels.map((panel) => [
    panel.code,
    {
      ...panel,
      unitNote:
        panel.code === 'FIO2'
          ? 'FiO₂ is displayed on the recorded percentage scale. Changes are expressed in percentage points. Clinicians may adjust the fraction of inspired oxygen during respiratory support.'
          : panel.code === 'VE'
            ? `${RECORDED_UNIT_NOTE} Ventilation mode was not available for this analysis.`
            : RECORDED_UNIT_NOTE,
    },
  ]),
) as unknown as Readonly<Record<(typeof OUTCOMES)[number], OutcomeMeta>>

/** Two-line outcome headings shared by component overview and its figure export. */
export const OUTCOME_HEADING_LINES = {
  ARTm: ['Mean arterial', 'pressure'],
  ARTs: ['Systolic arterial', 'pressure'],
  ARTd: ['Diastolic arterial', 'pressure'],
  HR: ['Heart', 'rate'],
  FIO2: ['Fraction of', 'inspired oxygen'],
  SPO2: ['Peripheral oxygen', 'saturation'],
  VE: ['Minute', 'ventilation'],
} as const satisfies Readonly<Record<(typeof OUTCOMES)[number], readonly [string, string]>>

export const POPULATION_LABELS = {
  PRIMARY: 'Primary cohort',
  FIRST_EVENT: 'First eligible event per patient',
  NO_FOLLOWING_UNIT_12H: 'No further recorded RBC transfusion within 12 hours',
} as const satisfies Readonly<Record<(typeof POPULATIONS)[number], string>>

export function timeWindowLabel(minutes: number): string {
  const hours = minutes / 60
  return hours === 1 ? '1 hour' : `${hours} hours`
}

export const COHORT_SLUG = {
  PRIMARY: 'primary-cohort',
  FIRST_EVENT: 'first-event-per-patient',
  NO_FOLLOWING_UNIT_12H: 'no-further-transfusion-within-12-hours',
} as const satisfies Record<FitKey['population'], string>

export const FACTOR_ADDRESS = {
  DonorHb_Cat: 'donor-hemoglobin',
  Storage_Cat: 'unit-storage-duration',
  DonorSex: 'donor-sex',
  DonorParity_Female: 'parity-among-female-donors',
  wdy_donation: 'donation-weekday',
} as const satisfies Record<Exclude<FitKey['factor'], 'MAIN'>, string>

export function outcomeAddress(code: FitKey['outcome']): string {
  return OUTCOME_META[code].name.toLowerCase().replace(/ /g, '-')
}

export function categoryAddress(factor: FitKey['factor'], code: string): string {
  return categoryLabel(factor, code).toLowerCase().replace(/ /g, '-')
}

// Accept either the analysis code or the readable URL value.
export function readSelection<T extends string>(
  query: URLSearchParams,
  key: string,
  codes: readonly T[],
  address: (code: T) => string,
): T | undefined {
  const values = query.getAll(key)
  return values.length === 1
    ? codes.find((code) => values[0] === code || values[0] === address(code))
    : undefined
}

export const MODEL_FILENAME = { BASE: 'base-model', FULL: 'fully-adjusted-model' } as const

export function cohortPhrase(cohort: FitKey['population']): string {
  switch (cohort) {
    case 'PRIMARY':
      return 'in the primary cohort'
    case 'FIRST_EVENT':
      return 'at the first eligible event per patient'
    case 'NO_FOLLOWING_UNIT_12H':
      return 'in events with no further recorded RBC transfusion within 12 hours'
  }
}

export function trajectoryTitle(
  releaseId: string | undefined,
  cohort: FitKey['population'],
  model: FitKey['model'],
  scale: 'levels' | 'changes',
  minutes: number,
): string {
  const phrase = cohortPhrase(cohort)
  if (
    isManuscriptRelease(releaseId) &&
    model === 'FULL' &&
    scale === 'changes' &&
    minutes === 720
  ) {
    const number = cohort === 'PRIMARY' ? 'Figure 1. ' : ''
    return `${number}Physiological trajectories surrounding red blood cell transfusion ${phrase}`
  }
  return scale === 'changes'
    ? `Change from one hour before transfusion start ${phrase}`
    : `Predicted physiological levels ${phrase}`
}

export function comparisonOverviewTitle(
  releaseId: string | undefined,
  cohort: FitKey['population'],
  model: FitKey['model'],
): string {
  if (isManuscriptRelease(releaseId) && cohort === 'PRIMARY' && model === 'FULL') {
    return 'Figure 2. Differences in physiological change by blood unit characteristic in the primary cohort'
  }
  return 'Differences in physiological change by blood unit characteristic'
}

const pairwiseFigureNumbers: Record<FitKey['outcome'], number> = {
  ARTm: 3,
  ARTs: 4,
  ARTd: 5,
  HR: 6,
  FIO2: 7,
  SPO2: 8,
  VE: 9,
}

export function pairwiseOverviewTitle(
  releaseId: string | undefined,
  cohort: FitKey['population'],
  model: FitKey['model'],
  outcome: FitKey['outcome'],
): string {
  const title = `Change in ${OUTCOME_META[outcome].name.toLowerCase()} by blood unit characteristic`
  if (isManuscriptRelease(releaseId) && cohort === 'PRIMARY' && model === 'FULL') {
    return `Figure S${pairwiseFigureNumbers[outcome]}. ${title}`
  }
  return title
}

export const POPULATION_NOTES = {
  PRIMARY:
    'An eligible event was the patient’s first recorded red blood cell (RBC) transfusion start or occurred more than 12 hours after the previous start. A further start within 12 hours was allowed but was ineligible as a new index event.',
  FIRST_EVENT:
    'We selected the earliest eligible event for each patient. If it lacked the data required for a model, we did not substitute a later event.',
  NO_FOLLOWING_UNIT_12H:
    'We retained primary events with no further recorded RBC start in the next 12 hours. The full 12-hour interval had to fall within the period covered by the transfusion extract. Units starting simultaneously formed one index event.',
} as const satisfies Readonly<Record<(typeof POPULATIONS)[number], string>>

export const MODEL_LABELS = {
  BASE: 'Base model (comparison)',
  FULL: 'Fully adjusted model (primary)',
} as const satisfies Readonly<Record<(typeof MODELS)[number], string>>

export const FACTOR_LABELS = {
  MAIN: 'All eligible events',
  DonorHb_Cat: 'Donor hemoglobin concentration (g/L)',
  Storage_Cat: 'Unit storage duration (days)',
  DonorSex: 'Donor sex',
  DonorParity_Female: 'Parity among female donors',
  wdy_donation: 'Donation weekday',
} as const satisfies Readonly<Record<(typeof FACTORS)[number], string>>

/** Presentation order shared by component summaries and all-pairs figures. */
export const COMPONENT_FACTOR_ORDER = [
  'DonorHb_Cat',
  'Storage_Cat',
  'wdy_donation',
  'DonorSex',
  'DonorParity_Female',
] as const satisfies readonly Exclude<(typeof FACTORS)[number], 'MAIN'>[]

/** Labels are keyed by the category codes in the analysis output. */
const CATEGORY_LABELS: Readonly<
  Record<(typeof FACTORS)[number], Readonly<Record<string, string>>>
> = categoryLabels

export function categoryLabel(factor: (typeof FACTORS)[number], code: string | number): string {
  if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, factor))
    throw new Error('UNKNOWN_FACTOR')
  const categories = CATEGORY_LABELS[factor]
  const key = String(code)
  if (!Object.prototype.hasOwnProperty.call(categories, key))
    throw new Error('UNKNOWN_CATEGORY_CODE')
  return categories[key]!
}

export function formatUnitRange(label: string): string {
  return label
    .replace(/^Below (\d+)$/, '<$1')
    .replace(/ to (below|under) /, ' to <')
    .replace(/^(\d+) or (above|more)$/, '≥$1')
}

export function categoryCaption(factor: FitKey['factor'], code: string | number): string {
  return formatUnitRange(categoryLabel(factor, code))
}

export const PARITY_NOTE =
  'Among female donors, nulliparous means no previous births and parous means one or more previous births.'

export const REFERENCE_PROFILE_NOTE =
  'Predictions are for a male recipient in the most frequently recorded ICU ward. Each numeric covariate is held at its mean across the measurements included in that model. The two sedative/analgesic indicators in FULL are set to the proportions of included measurements with a positive summary.'

export const FULL_MODEL_NOTE =
  'The fully adjusted model (FULL) adds crystalloid, noradrenaline and sedative/analgesic summaries from the 1 and 24 hours before each measurement. These windows may include treatment after transfusion start. Samples and prediction profiles can differ by model. In Table 2, BASE and FULL had identical patient, event and measurement counts for each outcome.'

export const PRIMARY_CHANGE_NOTE =
  'The primary contrast is the predicted value one hour after transfusion start minus the predicted value one hour before start. Its confidence interval accounts for the covariance between these predictions.'
