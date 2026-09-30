const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export function monthIndex(key) {
  return parseInt(key.slice(5, 7), 10) - 1
}

export function monthShort(key) {
  if (!key) return ''
  return `${MONTH_SHORT[monthIndex(key)]} ${key.slice(2, 4)}`
}

export function monthLong(key) {
  if (!key) return ''
  return `${MONTH_LONG[monthIndex(key)]} ${key.slice(0, 4)}`
}

/** Full date from an ISO 'YYYY-MM-DD' string, e.g. '2025-08-06' -> '6 August 2025'. */
export function dayLong(iso) {
  if (!iso) return ''
  const day = parseInt(iso.slice(8, 10), 10)
  return `${day} ${MONTH_LONG[monthIndex(iso)]} ${iso.slice(0, 4)}`
}

/** Axis ticks: show the year on January, the month otherwise. */
export function axisTick(key) {
  if (!key) return ''
  return key.slice(5, 7) === '01' ? key.slice(0, 4) : MONTH_SHORT[monthIndex(key)]
}

export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function pp(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(digits)}pp`
}

export function num(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

/** Weight is stored per 1000 of the basket; show it as a share. */
export function weightPct(value) {
  if (value === null || value === undefined) return '—'
  return `${(value / 10).toFixed(1)}%`
}

/**
 * Direction colour for a month-on-month change.
 *
 * Deliberately neutral rather than red/green: a rise in inflation is not
 * "bad" and a fall is not "good" in any way this dashboard should assert.
 * The arrow glyph carries the direction so it is never colour-alone.
 */
export function deltaTone(value) {
  if (value === null || value === undefined || value === 0) return 'text-faint'
  return value > 0 ? 'text-[#E9B872]' : 'text-[#7FB9E8]'
}

export function deltaArrow(value) {
  if (value === null || value === undefined || value === 0) return '→'
  return value > 0 ? '↑' : '↓'
}

export function addMonths(key, delta) {
  const year = parseInt(key.slice(0, 4), 10)
  const month = parseInt(key.slice(5, 7), 10) - 1
  const total = year * 12 + month + delta
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

export function clampRange(observations, from, to) {
  return observations.filter((row) => row.date >= from && row.date <= to)
}

/** Signed basis points, e.g. 12.3 -> '+12bp'. */
export function bp(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(digits)}bp`
}

/** Thousands with sign, e.g. payroll changes: 142 -> '+142k'. */
export function kSigned(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(0)}k`
}

/** Compact contract counts, e.g. -123456 -> '−123k'. */
export function contracts(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}m`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}k`
  return `${sign}${abs.toFixed(0)}`
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-09-29' -> '29 Sep 26'. */
export function dayShort(iso) {
  if (!iso) return ''
  return `${parseInt(iso.slice(8, 10), 10)} ${MONTH_ABBR[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(2, 4)}`
}

/** Axis ticks for daily/weekly data: year on January dates, month otherwise. */
export function axisTickDay(iso) {
  if (!iso) return ''
  const month = parseInt(iso.slice(5, 7), 10) - 1
  return month === 0 ? iso.slice(0, 4) : MONTH_ABBR[month]
}
