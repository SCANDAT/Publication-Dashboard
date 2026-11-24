export const POPULATIONS = ['PRIMARY', 'FIRST_EVENT', 'NO_FOLLOWING_UNIT_12H'] as const
export const MODELS = ['BASE', 'FULL'] as const
export const FACTORS = [
  'MAIN',
  'DonorHb_Cat',
  'Storage_Cat',
  'DonorSex',
  'DonorParity_Female',
  'wdy_donation',
] as const
export const OUTCOMES = ['ARTm', 'ARTs', 'ARTd', 'HR', 'FIO2', 'SPO2', 'VE'] as const

export interface FitKey {
  readonly population: (typeof POPULATIONS)[number]
  readonly model: (typeof MODELS)[number]
  readonly factor: (typeof FACTORS)[number]
  readonly outcome: (typeof OUTCOMES)[number]
}
