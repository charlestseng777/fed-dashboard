// Palette and series registry.
//
// Same validated dark categorical ramp as the UK dashboard. SLOT ORDER is
// load-bearing: toggle rows and legends render in this sequence so that every
// adjacent pair is one the colour-vision validator cleared.
//
//   validate_palette.py "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767" \
//       --mode dark --surface "#161A23" --pairs adjacent   ->  ALL CHECKS PASS

export const PALETTE = {
  blue: '#3987e5',    // slot 1
  orange: '#d95926',  // slot 2
  aqua: '#199e70',    // slot 3
  yellow: '#c98500',  // slot 4
  magenta: '#d55181', // slot 5
  green: '#008300',   // slot 6
  violet: '#9085e9',  // slot 7
  red: '#e66767',     // slot 8
  neutral: '#5A6273',
}

export const CHROME = {
  surface: '#161A23',
  grid: '#232733',
  axis: '#2E3545',
  muted: '#8A93A6',
  faint: '#5A6273',
}

const P = PALETTE

// ---- Macro tab -----------------------------------------------------------

export const INFLATION_SERIES = [
  { id: 'core_pce', label: 'Core PCE y/y', short: 'Core PCE', color: P.blue, width: 2.5, locked: true },
  { id: 'ff_upper', label: 'Fed funds (upper)', short: 'Fed funds', color: P.orange, width: 2, locked: true, step: true },
  { id: 'core_cpi', label: 'Core CPI y/y', short: 'Core CPI', color: P.aqua, width: 2, on: true },
  { id: 'supercore', label: 'Supercore CPI y/y', short: 'Supercore', color: P.yellow, width: 1.75 },
  { id: 'shelter', label: 'Shelter CPI y/y', short: 'Shelter', color: P.magenta, width: 1.75 },
  { id: 'headline_cpi', label: 'Headline CPI y/y', short: 'Headline CPI', color: P.green, width: 1.75 },
  { id: 'core_pce_3m', label: 'Core PCE 3m annualised', short: 'Core PCE 3m', color: P.violet, width: 1.5, dashed: true },
]

export const LABOUR_SERIES = [
  { id: 'payrolls', label: 'Nonfarm payrolls, m/m (k)', short: 'Payrolls', color: P.blue, type: 'bar', axis: 'right', locked: true },
  { id: 'unemployment', label: 'Unemployment rate (%)', short: 'Unemployment', color: P.orange, width: 2.25, locked: true },
  { id: 'payrolls_3m', label: 'Payrolls 3m avg (k)', short: 'Payrolls 3m', color: P.aqua, width: 1.75, axis: 'right', on: true },
  { id: 'ahe', label: 'Avg hourly earnings y/y (%)', short: 'AHE', color: P.yellow, width: 1.75 },
  { id: 'openings', label: 'Job openings (m)', short: 'Openings', color: P.magenta, width: 1.75 },
  { id: 'atl_wage', label: 'Atlanta Fed wage tracker (%)', short: 'Atl wage', color: P.green, width: 1.75 },
  { id: 'v_u', label: 'Openings per unemployed', short: 'V/U', color: P.violet, width: 1.75 },
]

export const GROWTH_SERIES = [
  { id: 'retail', label: 'Retail sales y/y (%)', short: 'Retail', color: P.blue, width: 2, locked: true },
  { id: 'ip', label: 'Industrial production y/y (%)', short: 'IP', color: P.orange, width: 2, locked: true },
  { id: 'philly', label: 'Philly Fed mfg (diffusion)', short: 'Philly Fed', color: P.aqua, width: 1.5, axis: 'right', on: true },
  { id: 'empire', label: 'Empire State mfg (diffusion)', short: 'Empire', color: P.yellow, width: 1.5, axis: 'right' },
]

// ---- Rates tab (daily) ---------------------------------------------------

export const YIELD_SERIES = [
  { id: 'ust_2y', label: '2Y Treasury', short: '2Y', color: P.blue, width: 2, locked: true },
  { id: 'ust_10y', label: '10Y Treasury', short: '10Y', color: P.orange, width: 2, locked: true },
  { id: 'ust_5y', label: '5Y Treasury', short: '5Y', color: P.aqua, width: 1.5, on: true },
  { id: 'ust_30y', label: '30Y Treasury', short: '30Y', color: P.yellow, width: 1.5, on: true },
  { id: 'ff_upper', label: 'Fed funds (upper)', short: 'Fed funds', color: P.neutral, width: 1.5, step: true, on: true },
  { id: 'sofr', label: 'SOFR', short: 'SOFR', color: P.violet, width: 1.25 },
]

export const CURVE_SERIES = [
  { id: 's2s10', label: '2s10s (bp)', short: '2s10s', color: P.blue, width: 2, locked: true },
  { id: 's5s30', label: '5s30s (bp)', short: '5s30s', color: P.orange, width: 2, locked: true },
]

export const TERM_PREMIUM_SERIES = [
  { id: 'ust_10y', label: '10Y yield', short: '10Y', color: P.blue, width: 2, locked: true },
  { id: 'acm_rn10', label: 'Expected path (ACM risk-neutral)', short: 'Expected path', color: P.orange, width: 2, locked: true },
  { id: 'acm_tp10', label: 'ACM term premium', short: 'Term premium', color: P.aqua, width: 2, locked: true, axis: 'right' },
  { id: 'kw_tp10', label: 'Kim-Wright term premium', short: 'Kim-Wright', color: P.yellow, width: 1.5, axis: 'right' },
]

export const BREAKEVEN_SERIES = [
  { id: 'be_5y', label: '5Y breakeven', short: '5Y BE', color: P.blue, width: 2, locked: true },
  { id: 'be_5y5y', label: '5y5y forward breakeven', short: '5y5y', color: P.orange, width: 2, locked: true },
  { id: 'be_10y', label: '10Y breakeven', short: '10Y BE', color: P.aqua, width: 1.5, on: true },
  { id: 'real_10y', label: '10Y real yield (TIPS)', short: '10Y real', color: P.yellow, width: 1.5 },
  { id: 'gold', label: 'Gold, COMEX front month ($/oz)', short: 'Gold', color: P.magenta, width: 1.5, axis: 'right', on: true,
    format: (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
]

export const PRICED_SERIES = [
  { id: 'priced_12m', label: 'Change priced over next 12m (bp)', short: 'Priced 12m', color: P.blue, width: 2, locked: true },
]

// ---- Positioning tab (weekly) --------------------------------------------

export const POSITIONING_SERIES = [
  { id: 'ust_lev_dv01', label: 'Leveraged funds, UST futures ($m/bp)', short: 'Lev funds', color: P.blue, width: 2, locked: true },
  { id: 'ust_am_dv01', label: 'Asset managers, UST futures ($m/bp)', short: 'Asset mgrs', color: P.orange, width: 2, locked: true },
]

export const CONTRACT_COLORS = {
  ff: P.blue, sr3: P.orange, tu: P.aqua, fv: P.yellow, ty: P.magenta, tn: P.green, us: P.violet, ub: P.red,
}

// Direction tones, same vocabulary as the UK app: amber = up/hawkish, blue =
// down/dovish. Never red/green — neither direction is "good".
export const TONE = {
  hawkish: { label: 'Hawkish', className: 'border-[#E9B872]/40 bg-[#E9B872]/10 text-[#E9B872]' },
  dovish: { label: 'Dovish', className: 'border-[#7FB9E8]/40 bg-[#7FB9E8]/10 text-[#7FB9E8]' },
  neutral: { label: 'Neutral', className: 'border-hairline bg-white/[0.03] text-muted' },
  unclear: { label: 'No read', className: 'border-hairline bg-white/[0.03] text-faint' },
}
