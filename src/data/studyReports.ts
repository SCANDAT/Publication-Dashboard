import { FACTOR_LABELS } from './display'

export const COUNT_LABELS = {
  PERSONS: 'Patients',
  ICU_ADMISSIONS: 'ICU admissions',
  INDEX_EVENTS: 'Eligible transfusion events',
  LINKED_PHYSICAL_UNITS: 'RBC units',
} as const

export const UNIT_FACTOR_LABELS = {
  DonorHb: FACTOR_LABELS.DonorHb_Cat,
  Storage: FACTOR_LABELS.Storage_Cat,
  DonorSex: 'Donor sex',
  DonorParity: FACTOR_LABELS.DonorParity_Female,
  DonationWeekday: FACTOR_LABELS.wdy_donation,
} as const

export type CountUnit = keyof typeof COUNT_LABELS
export type Numeric = number | null

export function value(value: Numeric, digits = 1): string {
  return value === null
    ? 'Unavailable'
    : value.toLocaleString('en-GB', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
}
