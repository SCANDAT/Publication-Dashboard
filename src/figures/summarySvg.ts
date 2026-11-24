import type { FitKey } from '../data/release'
import type { TrajectoryPoint } from '../data/tables'

import {
  formatProbability,
  isPrintedProbability,
  overallProbability,
  type DisplayComparison,
  type DisplayProbability,
} from '../data/componentDisplay'
import {
  axisTicks,
  curveDomain,
  formatTick,
  formatValue,
  type CurveDomain,
} from '../components/trajectoryGeometry'
import { MODELS, POPULATIONS } from '../data/release'
import { hasUsableBand, hasUsableEstimate, trajectorySegments } from '../data/tables'
import {
  timeWindowLabel,
  trajectoryTitle,
  comparisonOverviewTitle,
  COMPONENT_FACTOR_ORDER,
  OUTCOME_HEADING_LINES,
  OUTCOME_META,
  PANEL_ORDER,
  POPULATION_LABELS,
  POPULATION_NOTES,
  MODEL_LABELS,
  FACTOR_LABELS,
  categoryCaption,
  PARITY_NOTE,
} from '../data/display'
import { displayPairs } from '../data/pairwiseDisplay'

export interface SummaryContext {
  releaseId: string
  model: FitKey['model']
}
export interface SummaryInterval {
  estimate: number | null
  lower: number | null
  upper: number | null
}
export interface TrajectorySummaryPanel {
  outcome: FitKey['outcome']
  points: readonly TrajectoryPoint[]
  domain?: CurveDomain
  contrast?: SummaryInterval
}
export interface TrajectorySummaryInput extends SummaryContext {
  population: FitKey['population']
  scale: 'levels' | 'changes'
  windowMinutes: number
  panels: readonly TrajectorySummaryPanel[]
}

export interface ComponentSummaryCell {
  outcome: FitKey['outcome']
  result: DisplayComparison
}
export interface ComponentSummaryFactor {
  factor: Exclude<FitKey['factor'], 'MAIN'>
  categoryCodes: readonly string[]
  cells: readonly ComponentSummaryCell[]
}
export interface ComponentSummaryInput extends SummaryContext {
  population: FitKey['population']
  factors: readonly ComponentSummaryFactor[]
}
export interface SensitivitySummaryRow extends SummaryInterval {
  population: FitKey['population']
  unavailableLabel?: string
}
export interface SensitivitySummaryInput extends SummaryContext {
  panels: readonly { outcome: FitKey['outcome']; rows: readonly SensitivitySummaryRow[] }[]
}

const WIDTH = 1680,
  HEIGHT = 1188,
  MARGIN = 48,
  GAP = 26
const PANEL_WIDTH = (WIDTH - 2 * MARGIN - 3 * GAP) / 4,
  PANEL_HEIGHT = 408
const INK = '#24333D',
  MUTED = '#52616A',
  GRID = '#E3E9EB'
const FACTOR_ORDER = COMPONENT_FACTOR_ORDER
function check(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason)
}
function finite(value: number | null): boolean {
  return value === null || Number.isFinite(value)
}
function xml(value: string): string {
  check(
    [...value].every((character) => {
      const code = character.codePointAt(0)!
      return code >= 32 || code === 9 || code === 10 || code === 13
    }),
    'SVG_INVALID_TEXT',
  )
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
function publicText(value: string): string {
  check(
    value.length <= 1200 && !/[A-Za-z]:[\\/]|\\\\|(?:https?|file):\/\//i.test(value),
    'SVG_PRIVATE_OR_EXTERNAL_TEXT',
  )
  return xml(value)
}
function number(value: number): string {
  check(Number.isFinite(value), 'SVG_NONFINITE_COORDINATE')
  return Object.is(value, -0) ? '-0' : String(value)
}

function widthOf(value: string, font: number): number {
  return (
    [...value].reduce(
      (sum, char) =>
        sum +
        (/\s/.test(char)
          ? 0.32
          : /[ilI.,:;!'|]/.test(char)
            ? 0.3
            : /[MW@%]/.test(char)
              ? 0.96
              : /[A-Z0-9]/.test(char)
                ? 0.68
                : 0.58),
      0,
    ) * font
  )
}
function wrap(value: string, width: number, font: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/)) {
    if (!word) continue
    if (line && widthOf(line + ' ' + word, font) > width) {
      lines.push(line)
      line = ''
    }
    if (widthOf(word, font) > width) {
      for (const character of word) {
        if (line && widthOf(line + character, font) > width) {
          lines.push(line)
          line = ''
        }
        line += character
      }
    } else line += (line ? ' ' : '') + word
  }
  if (line) lines.push(line)
  return lines
}
function text(
  x: number,
  y: number,
  value: string,
  font = 16,
  anchor = 'start',
  color = INK,
  bold = false,
  heading = false,
): string {
  return `<text x="${number(x)}" y="${number(y)}" font-size="${font}" text-anchor="${anchor}" fill="${color}"${bold ? ' font-weight="700"' : ''}${heading ? ' font-family="&apos;Libre Caslon Text&apos;, &apos;Source Serif 4&apos;, Georgia, serif"' : ''}>${publicText(value)}</text>`
}
function block(
  x: number,
  y: number,
  value: string,
  width: number,
  font = 16,
  maxHeight = 160,
  color = MUTED,
  lineHeight = 1.35,
): string {
  const lines = wrap(value, width, font),
    leading = font * lineHeight
  check(lines.length * leading <= maxHeight, 'SVG_TEXT_OVERFLOW')
  return lines
    .map((line, index) => text(x, y + index * leading, line, font, 'start', color))
    .join('')
}
function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = GRID,
  stroke = 1,
  dashed = false,
): string {
  return `<line x1="${number(x1)}" y1="${number(y1)}" x2="${number(x2)}" y2="${number(y2)}" stroke="${color}" stroke-width="${stroke}"${dashed ? ' stroke-dasharray="5 4"' : ''}/>`
}
function circle(x: number, y: number, color: string, reference = false): string {
  return `<circle cx="${number(x)}" cy="${number(y)}" r="${reference ? 4.3 : 3.9}" fill="${reference ? 'white' : color}" stroke="${reference ? '#78868D' : 'white'}" stroke-width="${reference ? 1.6 : 0.9}"/>`
}
function validFigureProbability(p: DisplayProbability | null) {
  return (
    p === null ||
    (typeof p === 'number' ? Number.isFinite(p) && p >= 0 && p <= 1 : isPrintedProbability(p))
  )
}
function validateContext(input: SummaryContext): void {
  check(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(input.releaseId), 'SVG_INVALID_RELEASE_ID')
  check(MODELS.includes(input.model), 'SVG_INVALID_MODEL')
}
function population(value: FitKey['population']): void {
  check(POPULATIONS.includes(value), 'SVG_INVALID_POPULATION')
}
function ordered<T extends { outcome: FitKey['outcome'] }>(panels: readonly T[]): T[] {
  check(
    panels.length === PANEL_ORDER.length &&
      new Set(panels.map((panel) => panel.outcome)).size === PANEL_ORDER.length,
    'SVG_OUTCOME_INVENTORY',
  )
  return PANEL_ORDER.map((outcome) => {
    const panel = panels.find((item) => item.outcome === outcome)
    check(panel, 'SVG_OUTCOME_INVENTORY')
    return panel
  })
}
function interval(value: SummaryInterval): void {
  check(
    finite(value.estimate) && finite(value.lower) && finite(value.upper),
    'SVG_NONFINITE_RESULT',
  )
  check((value.lower === null) === (value.upper === null), 'SVG_PARTIAL_INTERVAL')
  if (value.lower !== null && value.upper !== null)
    check(
      value.estimate !== null && value.lower <= value.estimate && value.estimate <= value.upper,
      'SVG_INVALID_INTERVAL',
    )
}
function intervalText(value: SummaryInterval): string {
  if (value.estimate === null) return 'Estimate unavailable'
  return `${formatValue(value.estimate)}${value.lower === null || value.upper === null ? ' (CI unavailable)' : ` (95% CI ${formatValue(value.lower)} to ${formatValue(value.upper)})`}`
}
function symmetricLimit(
  values: readonly number[],
  multiplier: number,
  floor: number,
): number | null {
  if (!values.length) return null
  const extent = Math.max(...values.map(Math.abs), floor) * multiplier
  const step = 10 ** Math.floor(Math.log10(extent))
  return Math.ceil(extent / step) * step
}
function panelTitle(outcome: FitKey['outcome'], unit: string): string {
  const meta = OUTCOME_META[outcome]
  check(/^#[0-9A-Fa-f]{6}$/.test(meta.color), 'SVG_INVALID_COLOR')
  const titleLines = wrap(meta.name, PANEL_WIDTH - 20, 21)
  check(titleLines.length <= 2, 'SVG_TITLE_OVERFLOW')
  return (
    titleLines
      .map((title, i) => text(0, 23 + i * 24, title, 21, 'start', meta.color, true, true))
      .join('') + text(0, 76, unit, 16, 'start', MUTED)
  )
}
function adjustment(model: FitKey['model']): string {
  const base =
    'BASE adjusted for recipient age and sex, ward, admission-to-transfusion time and earlier RBC units in the admission.'
  return model === 'BASE'
    ? base
    : base +
        ' FULL added recorded 1- and 24-hour crystalloid, noradrenaline and sedative/analgesic histories before each measurement; these may include treatment after transfusion.'
}
type KeySymbol = 'line' | 'band' | 'event' | 'dots' | 'interval' | 'zero'
function keySymbol(kind: KeySymbol, x: number, y: number): string {
  const color = '#476D69'
  let shape = ''
  if (kind === 'line') shape = line(x, y, x + 34, y, color, 2.5)
  if (kind === 'band')
    shape =
      `<rect x="${x}" y="${y - 7}" width="34" height="14" fill="${color}" fill-opacity="0.2"/>` +
      line(x, y, x + 34, y, color, 1.8)
  if (kind === 'event' || kind === 'zero')
    shape = line(x + 17, y - 11, x + 17, y + 11, '#89979D', 1.3, true)
  if (kind === 'dots') shape = circle(x + 6, y, color) + circle(x + 28, y, color)
  if (kind === 'interval') shape = line(x, y, x + 34, y, color, 2) + circle(x + 17, y, color)
  return `<g data-key-symbol="${kind}">${shape}</g>`
}
function keyCard(
  title: string,
  items: readonly [KeySymbol, string][],
  paragraphs: readonly string[],
): string {
  let result =
    `<g data-role="visual-key"><rect x="-12" y="-10" width="${number(PANEL_WIDTH + 24)}" height="${number(PANEL_HEIGHT + 22)}" rx="8" fill="#F3F7F5" stroke="#D8E4DF"/>` +
    text(0, 23, title, 21, 'start', INK, true, true)
  items.forEach(([symbol, label], index) => {
    const y = 63 + index * 37
    result += keySymbol(symbol, 0, y - 4) + block(49, y, label, PANEL_WIDTH - 53, 15.5, 38)
  })
  let y = 76 + items.length * 37
  for (const paragraph of paragraphs) {
    const height = wrap(paragraph, PANEL_WIDTH - 4, 15.5).length * 15.5 * 1.35
    check(y + height <= PANEL_HEIGHT + 5, 'SVG_KEY_OVERFLOW')
    result += block(0, y, paragraph, PANEL_WIDTH - 4, 15.5, height + 1)
    y += height + 10
  }
  return result + '</g>'
}
interface FooterBlock {
  title: string
  text: string
}
function footerColumns(blocks: readonly FooterBlock[], top: number, height: number): string {
  const gap = 28,
    width = (WIDTH - MARGIN * 2 - gap * (blocks.length - 1)) / blocks.length
  return blocks
    .map((item, index) => {
      const x = MARGIN + index * (width + gap)
      return `<g data-role="footer-block">${text(x, top, item.title, 16, 'start', INK, true, true)}${block(x, top + 25, item.text, width, 14, height - 25, MUTED, 1.25)}</g>`
    })
    .join('')
}
function document(
  title: string,
  subtitle: string,
  drawing: string,
  footer: readonly FooterBlock[],
  footerTop = 1004,
  footerHeight = 150,
): string {
  const titleFontSize = Math.min(30, Math.floor((WIDTH - 2 * MARGIN) / widthOf(title, 1)))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg data-compact-summary="true" xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="summary-title summary-description"><title id="summary-title">${xml(title)}</title><desc id="summary-description">${xml(subtitle)}. Estimates and pointwise 95% confidence intervals are shown where available.</desc><rect width="${WIDTH}" height="${HEIGHT}" fill="white"/><g font-family="&apos;Source Serif 4&apos;, Georgia, serif" fill="${INK}">${text(MARGIN, 42, title, titleFontSize, 'start', INK, true, true)}${text(MARGIN, 77, subtitle, 18, 'start', MUTED)}${drawing}${footerColumns(footer, footerTop, footerHeight)}</g></svg>`
}

/** Complete selected trajectory grid. All visible source points survive, including gaps. */
export function trajectorySummarySvg(input: TrajectorySummaryInput): string {
  validateContext(input)
  population(input.population)
  check(input.scale === 'levels' || input.scale === 'changes', 'SVG_INVALID_SCALE')
  check([60, 360, 720].includes(input.windowMinutes), 'SVG_INVALID_WINDOW')
  const panels = ordered(input.panels),
    change = input.scale === 'changes'
  const prepared = panels.map((panel) => {
    const points = panel.points.filter(
      (point) => Math.abs(point.time) <= input.windowMinutes,
    )
    let previous = -Infinity
    for (const point of points) {
      check(
        point.category === 1 && Number.isInteger(point.time) && point.time > previous,
        'SVG_TRAJECTORY_GRID_ORDER',
      )
      previous = point.time
      check(
        finite(point.estimate) && finite(point.lower) && finite(point.upper),
        'SVG_NONFINITE_RESULT',
      )
      check(/^[A-Z_]{1,64}$/.test(point.numericStatus), 'SVG_INVALID_POINT_STATUS')
      if (point.estimate !== null) check(hasUsableEstimate(point), 'SVG_UNUSABLE_ESTIMATE')
      if (point.numericStatus === 'BASELINE_ZERO')
        check(
          change &&
            point.time === -60 &&
            point.estimate === 0 &&
            point.lower === 0 &&
            point.upper === 0,
          'SVG_INVALID_BASELINE_ZERO',
        )
      if (hasUsableBand(point)) interval(point)
    }
    if (panel.contrast) interval(panel.contrast)
    const domain = panel.domain ?? curveDomain(points, change)
    if (domain) {
      check(
        Number.isFinite(domain.min) && Number.isFinite(domain.max) && domain.min < domain.max,
        'SVG_INVALID_DOMAIN',
      )
      const values = points
        .flatMap((point) => [
          point.estimate,
          ...(hasUsableBand(point) ? [point.lower, point.upper] : []),
        ])
        .filter((v): v is number => v !== null)
      check(
        values.every((value) => value >= domain.min && value <= domain.max),
        'SVG_DOMAIN_CLIPS_VALUES',
      )
      if (change) check(domain.min <= 0 && domain.max >= 0, 'SVG_DOMAIN_EXCLUDES_ZERO')
    }
    return { panel, points, domain }
  })
  const pressure = prepared.filter(
    ({ panel, domain }) => ['ARTm', 'ARTs', 'ARTd'].includes(panel.outcome) && domain,
  )
  if (pressure.length && pressure.every(({ panel }) => !panel.domain)) {
    const span = Math.max(...pressure.map(({ domain }) => domain!.max - domain!.min))
    const shared = {
      min: Math.min(...pressure.map(({ domain }) => domain!.min)),
      max: Math.max(...pressure.map(({ domain }) => domain!.max)),
    }
    for (const item of pressure)
      item.domain = change
        ? shared
        : {
            min: (item.domain!.min + item.domain!.max - span) / 2,
            max: (item.domain!.min + item.domain!.max + span) / 2,
          }
  }

  let drawing = ''
  prepared.forEach(({ panel, points, domain }, index) => {
    const meta = OUTCOME_META[panel.outcome],
      unit = change ? meta.changeUnit : meta.unit
    const x0 = MARGIN + (index % 4) * (PANEL_WIDTH + GAP),
      y0 = 112 + Math.floor(index / 4) * (PANEL_HEIGHT + 26)
    let content = panelTitle(panel.outcome, unit)

    if (!domain)
      content += block(12, 190, 'No usable estimate', PANEL_WIDTH - 24, 18, 150)
    else {
      const L = 54,
        R = PANEL_WIDTH - 15,
        T = 102,
        B = 308
      const x = (value: number) =>
        L + ((value + input.windowMinutes) / (2 * input.windowMinutes)) * (R - L)
      const y = (value: number) => T + ((domain.max - value) / (domain.max - domain.min)) * (B - T)
      for (const value of axisTicks(domain)) {
        content +=
          line(L, y(value), R, y(value)) +
          text(L - 8, y(value) + 5, formatTick(value), 14, 'end', MUTED)
      }
      if (change) content += line(L, y(0), R, y(0), '#8D999F', 1.1, true)
      content += line(x(0), T, x(0), B, '#89959C', 1.2, true)
      for (const segment of trajectorySegments(points, 'band')) {
        const path =
          'M' +
          segment.map((p) => `${number(x(p.time))},${number(y(p.upper!))}`).join(' L') +
          ' L' +
          [...segment]
            .reverse()
            .map((p) => `${number(x(p.time))},${number(y(p.lower!))}`)
            .join(' L') +
          ' Z'
        content += `<path data-role="confidence-band" data-point-count="${segment.length}" d="${path}" fill="${meta.color}" fill-opacity="0.14"/>`
      }
      for (const segment of trajectorySegments(points)) {
        const path =
          'M' + segment.map((p) => `${number(x(p.time))},${number(y(p.estimate!))}`).join(' L')
        content += `<path data-role="trajectory" data-point-count="${segment.length}" d="${path}" fill="none" stroke="${meta.color}" stroke-width="2.2" stroke-linejoin="round"/>`
      }
      for (const p of points.filter((p) => Math.abs(p.time) === 60 && hasUsableEstimate(p)))
        content += circle(x(p.time), y(p.estimate!), meta.color)
      for (const tick of [
        -input.windowMinutes,
        -input.windowMinutes / 2,
        0,
        input.windowMinutes / 2,
        input.windowMinutes,
      ])
        content += text(
          x(tick),
          B + 24,
          `${tick > 0 ? '+' : ''}${formatTick(tick / 60)}`,
          14,
          'middle',
          MUTED,
        )
      content += text((L + R) / 2, B + 49, 'Hours from transfusion start', 15, 'middle', MUTED)
      content += text(0, 382, '1 h after minus 1 h before', 15, 'start', MUTED)
      content += block(
        0,
        404,
        panel.contrast
          ? intervalText(panel.contrast) + ' ' + meta.changeUnit
          : 'Comparison unavailable',
        PANEL_WIDTH,
        15,
        41,
      )
    }
    drawing += `<g data-outcome="${panel.outcome}" transform="translate(${number(x0)} ${number(y0)})">${content}</g>`
  })
  const keyX = MARGIN + 3 * (PANEL_WIDTH + GAP),
    keyY = 112 + PANEL_HEIGHT + 26
  const key = keyCard(
    'How to read the figure',
    [
      ['line', change ? 'Change from predicted −1 h value' : 'Predicted mean'],
      ['band', 'Pointwise 95% confidence interval'],
      ['event', 'Transfusion start'],
      ['dots', '−1 hour and +1 hour'],
    ],
    [
      'Below each panel: change from −1 to +1 hour with its own 95% confidence interval.',
      'Adjusted associations; individual responses may differ.',
    ],
  )
  drawing += `<g transform="translate(${number(keyX)} ${number(keyY)})">${key}</g>`
  const title = trajectoryTitle(
    input.releaseId,
    input.population,
    input.model,
    input.scale,
    input.windowMinutes,
  )
  const subtitle = `${MODEL_LABELS[input.model]} | ${POPULATION_LABELS[input.population]} | ${timeWindowLabel(input.windowMinutes)} before and after transfusion start`
  const footer = [
    {
      title: 'Cohort and predictions',
      text: `Intensive care unit (ICU) patients receiving red blood cell (RBC) transfusion. ${POPULATION_NOTES[input.population]} Predictions are evaluated at the reference profile for each model.`,
    },
    { title: 'Model adjustment', text: adjustment(input.model) },
    {
      title: 'Uncertainty and units',
      text: 'Pointwise confidence intervals account for repeated observations within patients. FiO₂ and SpO₂ changes are expressed in percentage points.',
    },
  ]
  return document(title, subtitle, drawing, footer)
}

/** Seven outcome columns, five factors; scientific pair orientation is reused unchanged. */
export function componentSummarySvg(input: ComponentSummaryInput): string {
  validateContext(input)
  population(input.population)
  check(
    input.factors.length === FACTOR_ORDER.length &&
      new Set(input.factors.map((f) => f.factor)).size === FACTOR_ORDER.length,
    'SVG_FACTOR_INVENTORY',
  )
  const factors = FACTOR_ORDER.map((factor) => {
    const item = input.factors.find((f) => f.factor === factor)
    check(item, 'SVG_FACTOR_INVENTORY')
    return item
  })
  const prepared = factors.map((factor) => {
    check(
      factor.categoryCodes.length >= 2 &&
        factor.categoryCodes.length <= 7 &&
        new Set(factor.categoryCodes).size === factor.categoryCodes.length,
      'SVG_CATEGORY_INVENTORY',
    )
    factor.categoryCodes.forEach((code) => categoryCaption(factor.factor, code))
    if (factor.factor === 'wdy_donation')
      check(factor.categoryCodes.join('/') === '2/3/4/5/6', 'SVG_WEEKDAY_COMPANION_SCOPE')
    const cells = ordered(factor.cells).map((cell) => {
      check(
        cell.result.plannedCategoryCodes.join('/') === factor.categoryCodes.join('/'),
        'SVG_COMPARISON_PLAN_MISMATCH',
      )
      if (factor.factor === 'wdy_donation') {
        check(
          cell.result.compactScope === 'MONDAY_FRIDAY' && cell.result.pairs.length === 10,
          'SVG_WEEKDAY_DISPLAY_SCOPE',
        )
      }
      const result = cell.result,
        reference = factor.categoryCodes[0]!
      const pairs = displayPairs(result, reference)
      pairs.forEach((pair) => {
        interval(pair)
        check(
          validFigureProbability(pair.pValue) && validFigureProbability(pair.holmP),
          'SVG_INVALID_P',
        )
      })
      const hasReference = Boolean(
        result.activeCategoryCodes.includes(reference) &&
          result.categories.some((row) => row.code === reference && row.status === 'COMPUTED'),
      )
      const endpointTest = result.tests.find((test) => test.kind === 'endpoint')

      if (endpointTest) check(validFigureProbability(endpointTest.pValue), 'SVG_INVALID_P')
      return { cell, pairs, hasReference, endpointTest }
    })
    return { factor, cells }
  })
  const bounds = Object.fromEntries(
    PANEL_ORDER.map((outcome) => [
      outcome,
      symmetricLimit(
        prepared.flatMap((f) =>
          f.cells
            .find((c) => c.cell.outcome === outcome)!
            .pairs.flatMap((p) => [p.estimate, p.lower, p.upper])
            .filter((v): v is number => v !== null),
        ),
        1.08,
        0.001,
      ),
    ]),
  ) as Record<FitKey['outcome'], number | null>
  const labelWidth = 336,
    left = MARGIN + labelWidth,
    gap = 18,
    colWidth = (WIDTH - MARGIN - left - 6 * gap) / 7
  let drawing = '',
    position = 228

  PANEL_ORDER.forEach((outcome, index) => {
    const meta = OUTCOME_META[outcome],
      center = left + index * (colWidth + gap) + colWidth / 2
    drawing += text(center, 120, meta.shortName, 20, 'middle', meta.color, true, true)
    const names = OUTCOME_HEADING_LINES[outcome]
    names.forEach((name, row) => {
      drawing += text(center, 149 + row * 18, name, 13, 'middle', MUTED)
    })
    wrap(meta.changeUnit, colWidth - 5, 15).forEach((unit, row) => {
      drawing += text(center, 198 + row * 18, unit, 15, 'middle', MUTED)
    })
  })
  for (const { factor, cells } of prepared) {
    const header = position,
      reference = factor.categoryCodes[0]!,
      rowHeight = 21
    const bodyTop = header + 33,
      bodyHeight = factor.categoryCodes.length * rowHeight + 8
    drawing +=
      `<rect x="${MARGIN - 4}" y="${header - 19}" width="${WIDTH - MARGIN * 2 + 8}" height="31" fill="#EEF2F4"/>` +
      text(
        MARGIN,
        header + 3,
        FACTOR_LABELS[factor.factor] +
          (factor.factor === 'wdy_donation' ? ' (Monday to Friday)' : ''),
        16.5,
        'start',
        INK,
        true,
        true,
      )
    factor.categoryCodes.forEach((code, index) => {
      drawing += text(
        MARGIN + 8,
        bodyTop + index * rowHeight,
        categoryCaption(factor.factor, code) + (code === reference ? ' (reference)' : ''),
        16,
      )
    })
    cells.forEach(({ cell, pairs, hasReference, endpointTest }, column) => {
      const meta = OUTCOME_META[cell.outcome],
        x0 = left + column * (colWidth + gap),
        bound = bounds[cell.outcome]
      const x = (value: number) => x0 + 8 + ((value + bound!) / (bound! * 2)) * (colWidth - 16)

      const p = endpointTest?.pValue,
        pText = p == null ? 'Overall p unavailable' : 'Overall p ' + overallProbability(p)
      drawing += `<g data-overall-p="${p == null ? 'unavailable' : xml(formatProbability(p))}" data-factor="${factor.factor}" data-outcome="${cell.outcome}"><title>${xml(endpointTest ? `Overall test of equal two-hour changes between categories. ${endpointTest.status === 'LOW_EFFECTIVE_DF' ? 'Low effective degrees of freedom. ' : ''}Unadjusted for multiple comparisons.` : 'Overall test unavailable.')}</title>${text(x0 + colWidth / 2, header + 3, pText + (endpointTest?.status === 'LOW_EFFECTIVE_DF' && p != null ? '\u2020' : ''), 13, 'middle', MUTED)}</g>`
      if (bound !== null)
        drawing += line(x(0), bodyTop - 17, x(0), bodyTop + bodyHeight - 16, '#919DA3', 1, true)
      if (hasReference)
        drawing += `<g data-reference="true" data-outcome="${cell.outcome}" data-factor="${factor.factor}"><title>${xml(categoryCaption(factor.factor, reference))}: reference; zero by definition. No CI or p value.</title>${circle(bound === null ? x0 + colWidth / 2 : x(0), bodyTop - 5, '#78868D', true)}</g>`
      pairs.forEach((pair) => {
        const row = factor.categoryCodes.indexOf(pair.a),
          y = bodyTop + row * rowHeight - 5
        check(row > 0 && pair.b === reference, 'SVG_REFERENCE_DIRECTION')
        if (pair.estimate === null || bound === null) {
          drawing += text(x0 + colWidth / 2, y + 5, 'Unavailable', 13, 'middle', MUTED)
          return
        }
        const description = `${categoryCaption(factor.factor, pair.a)} versus ${categoryCaption(factor.factor, pair.b)}: ${intervalText(pair)} ${meta.changeUnit}; Holm-adjusted p ${formatProbability(pair.holmP)}.`
        drawing += `<g data-pair="${xml(pair.a + '/' + pair.b)}" data-estimate="${number(pair.estimate)}"${pair.holmP === null ? '' : ` data-holm-p="${xml(formatProbability(pair.holmP))}"`}><title>${xml(description)}</title>`
        if (pair.lower !== null && pair.upper !== null)
          drawing += line(x(pair.lower), y, x(pair.upper), y, meta.color, 1.8)
        drawing += circle(x(pair.estimate), y, meta.color) + '</g>'
      })
    })
    position = bodyTop + bodyHeight + 13
  }
  check(position <= 970, 'SVG_COMPONENT_ROWS_OVERFLOW')
  PANEL_ORDER.forEach((outcome, index) => {
    const bound = bounds[outcome],
      x0 = left + index * (colWidth + gap)
    if (bound === null) {
      drawing += text(x0 + colWidth / 2, position + 12, 'No estimates', 14, 'middle', MUTED)
      return
    }
    drawing += line(x0 + 8, position - 2, x0 + colWidth - 8, position - 2, '#9FAAB0')
    ;[-bound, 0, bound].forEach((value, i) => {
      drawing += text(
        x0 + 8 + (i * (colWidth - 16)) / 2,
        position + 22,
        formatTick(value),
        14,
        i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
        MUTED,
      )
    })
  })
  drawing += text(
    left + (WIDTH - MARGIN - left) / 2,
    position + 54,
    'Difference in change: displayed category minus reference',
    17,
    'middle',
  )
  drawing += `<g data-role="component-symbol-key">${keySymbol('interval', MARGIN, 972)}${text(MARGIN + 46, 977, 'Estimate and pointwise 95% CI', 15)}${circle(650, 972, '#78868D', true)}${text(668, 977, 'Reference: zero by definition', 15)}${keySymbol('zero', 1165, 972)}${text(1210, 977, 'Equal changes', 15)}</g>`
  const hasLowDfOverallTest = prepared.some(
    (factor) =>
      factor.cells.some(
        ({ endpointTest }) =>
          endpointTest?.status === 'LOW_EFFECTIVE_DF' && endpointTest.pValue !== null,
      ),
  )
  const footer = [
    {
      title: 'Differences in change',
      text: 'Estimates compare category-specific changes from −1 to +1 hour with the reference-category change. Bars: pointwise 95% CIs. Open circles: reference (zero). Positive estimates indicate a greater increase or smaller decrease than the reference.',
    },
    {
      title: 'Statistical comparisons',
      text:
        'Overall p values test whether the two-hour change differs across categories. They are unadjusted. Pairwise p values are Holm-adjusted for each characteristic, outcome, cohort and model. Intervals are pointwise.' +
        (hasLowDfOverallTest
          ? ' \u2020 Low effective degrees of freedom for the overall test.'
          : ''),
    },
    { title: 'Model adjustment', text: adjustment(input.model) },
    {
      title: 'Cohort and units',
      text: `Intensive care patients receiving red blood cells. ${PARITY_NOTE} Donation weekday models include all seven days. Comparisons cover Monday through Friday. FiO₂ and SpO₂ changes are in percentage points.`,
    },
  ]
  return document(
    comparisonOverviewTitle(input.releaseId, input.population, input.model),
    `${MODEL_LABELS[input.model]} | ${POPULATION_LABELS[input.population]} | Five blood unit characteristics`,
    drawing,
    footer,
  )
}

/** Seven three-population forests in the same four-by-two summary layout. */
export function sensitivitySummarySvg(input: SensitivitySummaryInput): string {
  validateContext(input)
  const panels = ordered(input.panels)
  let drawing = ''
  panels.forEach((panel, index) => {
    check(
      panel.rows.length === POPULATIONS.length &&
        new Set(panel.rows.map((row) => row.population)).size === POPULATIONS.length,
      'SVG_SENSITIVITY_INVENTORY',
    )
    const rows = POPULATIONS.map((pop) => {
      const row = panel.rows.find((row) => row.population === pop)
      check(row, 'SVG_SENSITIVITY_INVENTORY')
      interval(row)
      return row
    })
    const meta = OUTCOME_META[panel.outcome],
      bound = symmetricLimit(
        rows
          .flatMap((row) => [row.estimate, row.lower, row.upper])
          .filter((value): value is number => value !== null),
        1.12,
        0.01,
      )
    let content = panelTitle(panel.outcome, meta.changeUnit)
    const labelWidth = 121,
      plotL = 133,
      plotR = 246,
      numberL = 259,
      numberR = PANEL_WIDTH - 4
    const x = (value: number) => plotL + ((value + bound!) / (2 * bound!)) * (plotR - plotL)
    content +=
      text(0, 105, 'Cohort', 13, 'start', MUTED) +
      text((plotL + plotR) / 2, 105, meta.changeUnit, 13, 'middle', MUTED) +
      `<g data-role="sensitivity-number-heading">${text(numberR, 97, 'Estimate', 13, 'end', MUTED)}${text(numberR, 113, '(95% CI)', 12.5, 'end', MUTED)}</g>`
    if (bound !== null)
      content += `<g data-role="sensitivity-zero">${line(x(0), 119, x(0), 359, '#919DA3', 1.1, true)}</g>`
    rows.forEach((row, rowIndex) => {
      const y = 150 + rowIndex * 85,
        labelLines = wrap(POPULATION_LABELS[row.population], labelWidth, 15)
      content += `<g data-role="sensitivity-row" data-row-population="${row.population}" data-center-y="${y}">`
      content +=
        `<g data-role="sensitivity-label">` +
        labelLines
          .map((value, i) =>
            text(0, y + 5.6 + (i - (labelLines.length - 1) / 2) * 18, value, 15, 'start', MUTED),
          )
          .join('') +
        '</g>'
      if (row.estimate !== null && bound !== null) {
        content += `<g data-population="${row.population}" data-estimate="${number(row.estimate)}">`
        if (row.lower !== null && row.upper !== null)
          content += line(x(row.lower), y, x(row.upper), y, meta.color, 2)
        content += circle(x(row.estimate), y, meta.color) + '</g>'
        content += `<g data-role="sensitivity-number">${text(numberR, y - 4, formatValue(row.estimate), 17, 'end', INK, true)}`
        content +=
          row.lower !== null && row.upper !== null
            ? text(
                numberR,
                y + 15,
                `(${formatValue(row.lower)} to ${formatValue(row.upper)})`,
                12,
                'end',
                MUTED,
              )
            : block(numberL, y + 14, 'Interval unavailable', numberR - numberL, 12, 40)
        content += '</g>'
      } else
        content += `<g data-role="sensitivity-number">${block(numberL, y + 2, row.unavailableLabel ?? 'Unavailable', numberR - numberL, 13, 60)}</g>`
      content += '</g>'
    })
    if (bound !== null) {
      content += line(plotL, 372, plotR, 372, '#9FAAB0')
      ;[-bound, 0, bound].forEach((value, i) => {
        content += text(
          x(value),
          397,
          formatTick(value),
          14,
          i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
          MUTED,
        )
      })
    }
    drawing += `<g data-outcome="${panel.outcome}" transform="translate(${number(MARGIN + (index % 4) * (PANEL_WIDTH + GAP))} ${number(112 + Math.floor(index / 4) * (PANEL_HEIGHT + 26))})">${content}</g>`
  })
  const key = keyCard(
    'Cohorts compared',
    [
      ['interval', 'Change from −1 hour to +1 hour'],
      ['interval', 'Pointwise 95% confidence interval'],
      ['zero', 'No change'],
    ],
    [
      `${POPULATION_LABELS.PRIMARY} allows a later transfusion.`,
      `${POPULATION_LABELS.FIRST_EVENT} includes one event per patient.`,
      `${POPULATION_LABELS.NO_FOLLOWING_UNIT_12H} requires records covering the full 12 hours.`,
      'Each cohort has its own model and prediction profile.',
    ],
  )
  drawing += `<g transform="translate(${number(MARGIN + 3 * (PANEL_WIDTH + GAP))} ${112 + PANEL_HEIGHT + 26})">${key}</g>`
  const footer = [
    {
      title: 'Cohorts and events',
      text: 'Intensive care unit (ICU) patients receiving red blood cell (RBC) transfusion. Primary events had no recorded RBC start in the preceding 12 hours. A further start within 12 hours was allowed but could not serve as a new index event. The two sensitivity cohorts are overlapping subsets of the primary cohort.',
    },
    { title: 'Model adjustment', text: adjustment(input.model) },
    {
      title: 'Uncertainty and interpretation',
      text: 'Pointwise confidence intervals account for repeated observations within patients. They describe predicted change within each cohort. The cohorts can overlap. FiO₂ and SpO₂ changes are expressed in percentage points.',
    },
  ]
  return document(
    'Sensitivity analyses',
    `${MODEL_LABELS[input.model]} | Change from 1 hour before to 1 hour after transfusion start`,
    drawing,
    footer,
  )
}
