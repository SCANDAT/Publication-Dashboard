export interface DisplayManifest {
  readonly schemaVersion: 'transfusion-dashboard/display-v2'
  readonly releaseId: string
  readonly assets: Readonly<Record<string, string>>
}
export const MANUSCRIPT_RELEASE_ID: 'transfusion-study-v5'
export function isManuscriptRelease(releaseId: string | undefined): boolean
export const COHORT_TABLE_KEYS: {
  readonly PRIMARY: 'tables/primary'
  readonly FIRST_EVENT: 'tables/first-event'
  readonly NO_FOLLOWING_UNIT_12H: 'tables/no-further-transfusion'
}
export function allStudyPopulationsSelected(isSelected: (key: string) => boolean): boolean
export function validateStudyScope(value: unknown, manifest: DisplayManifest): void
export function validateDisplayManifest(value: unknown): DisplayManifest
export function parseDisplayJson(text: string): unknown
