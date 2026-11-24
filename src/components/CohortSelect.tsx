import { POPULATION_LABELS } from '../data/display'
import { POPULATIONS, type FitKey } from '../data/release'

type Cohort = FitKey['population']

interface Props {
  label: string
  value: Cohort
  onChange: (cohort: Cohort) => void
}

export default function CohortSelect({ label, value, onChange }: Props) {
  return (
    <label className="cohort-control">
      {label}
      <span className="cohort-select">
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value as Cohort)}
        >
          {POPULATIONS.map((cohort) => (
            <option key={cohort} value={cohort}>
              {POPULATION_LABELS[cohort]}
            </option>
          ))}
        </select>
        <span className="cohort-select-value" aria-hidden="true">
          {POPULATION_LABELS[value]}
        </span>
      </span>
    </label>
  )
}
