// The "Fed watch" engine: turns the latest data into one read per category —
// is inflation converging, is the labour market loosening, what's priced —
// each tagged hawkish / dovish / neutral by explicit, visible thresholds.
//
// Deterministic by design, like the UK app's insight engine: it restates
// arithmetic already in the series against thresholds printed on the page,
// and asserts nothing beyond them.

import { bp, kSigned, pct, pp } from './format.js'

/** Latest row (at or before `index`) where `key` has a value. */
export function lastWith(rows, key, index = rows.length - 1) {
  for (let i = Math.min(index, rows.length - 1); i >= 0; i -= 1) {
    const v = rows[i]?.[key]
    if (v !== null && v !== undefined) return rows[i]
  }
  return null
}

function valueAt(rows, key, index) {
  return lastWith(rows, key, index)?.[key] ?? null
}

/** Value `months` rows earlier than the last row that has `key`. */
function monthsAgo(rows, key, months, index = rows.length - 1) {
  for (let i = Math.min(index, rows.length - 1); i >= 0; i -= 1) {
    if (rows[i]?.[key] !== null && rows[i]?.[key] !== undefined) {
      const j = i - months
      return j >= 0 ? rows[j]?.[key] ?? null : null
    }
  }
  return null
}

/** Value of a daily series ~`days` calendar days before its latest print. */
export function daysAgo(daily, key, days) {
  const last = lastWith(daily, key)
  if (!last) return null
  const cutoff = new Date(`${last.date}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const iso = cutoff.toISOString().slice(0, 10)
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (daily[i].date <= iso && daily[i][key] !== undefined && daily[i][key] !== null) return daily[i][key]
  }
  return null
}

const has = (v) => v !== null && v !== undefined && !Number.isNaN(v)

// ---------------------------------------------------------------------------

function inflationRead(monthly, index, nowcast) {
  const row = lastWith(monthly, 'core_pce', index)
  if (!row) return null
  const y = row.core_pce
  const m3 = row.core_pce_3m
  const m6 = row.core_pce_6m
  const cpi3 = valueAt(monthly, 'core_cpi_3m', index)
  const sc3 = valueAt(monthly, 'supercore_3m', index)

  let tone = 'neutral'
  let headline = `Core PCE ${pct(y)} y/y`
  if (has(m3) && has(y)) {
    if (m3 > y + 0.3 && m3 > 2.5) {
      tone = 'hawkish'
      headline += `, re-accelerating (3m annualised ${pct(m3)})`
    } else if (m3 < y - 0.3 && m3 < 2.75) {
      tone = 'dovish'
      headline += `, converging (3m annualised ${pct(m3)})`
    } else if (m3 >= 2.75) {
      tone = 'hawkish'
      headline += `, sticky above target (3m annualised ${pct(m3)})`
    } else {
      headline += `, steady (3m annualised ${pct(m3)})`
    }
  }

  const nc = nowcast?.monthly?.[0]
  const ncCore = nc?.values?.['Core PCE Inflation'] ?? nc?.values?.['Core PCE']
  return {
    id: 'inflation',
    label: 'Inflation',
    tone,
    date: row.date,
    headline,
    rule: 'Hawkish if 3m annualised core PCE is >0.3pp above y/y and >2.5%, or ≥2.75%; dovish if >0.3pp below y/y and <2.75%.',
    metrics: [
      ['Core PCE y/y', pct(y, 2)],
      ['Core PCE 3m / 6m ann.', `${pct(m3)} / ${pct(m6)}`],
      ['Core CPI 3m ann.', pct(cpi3)],
      ['Supercore 3m ann.', pct(sc3)],
      ncCore !== undefined ? [`Cleveland nowcast, core PCE m/m (${nc.period})`, pct(ncCore, 2)] : null,
    ].filter(Boolean),
  }
}

function labourRead(monthly, index, weekly) {
  const row = lastWith(monthly, 'unemployment', index)
  if (!row) return null
  const ur = row.unemployment
  const ur6 = monthsAgo(monthly, 'unemployment', 6, index)
  const sahm = valueAt(monthly, 'sahm', index)
  const pay3 = valueAt(monthly, 'payrolls_3m', index)
  const vu = valueAt(monthly, 'v_u', index)
  const wage = valueAt(monthly, 'ahe_3m', index)
  const claims = lastWith(weekly, 'icsa_4w')

  let tone = 'neutral'
  let headline = `Unemployment ${pct(ur)}`
  const dUr = has(ur) && has(ur6) ? ur - ur6 : null
  if ((has(sahm) && sahm >= 0.3) || (has(dUr) && dUr >= 0.3)) {
    tone = 'dovish'
    headline += `, loosening (${pp(dUr, 1)} over 6m, Sahm indicator ${pp(sahm)})`
  } else if (has(dUr) && dUr <= -0.2 && has(pay3) && pay3 > 150) {
    tone = 'hawkish'
    headline += `, tightening (${pp(dUr, 1)} over 6m, payrolls ${kSigned(pay3)}/month)`
  } else {
    headline += `, broadly stable (${pp(dUr, 1)} over 6m)`
  }

  return {
    id: 'labour',
    label: 'Labour',
    tone,
    date: row.date,
    headline,
    rule: 'Dovish if the Sahm indicator is ≥0.3pp or unemployment is up ≥0.3pp in 6 months; hawkish if unemployment is down ≥0.2pp with payrolls >150k/month.',
    metrics: [
      ['Payrolls, 3m avg', kSigned(pay3)],
      ['Sahm indicator', pp(sahm)],
      ['Openings per unemployed', has(vu) ? vu.toFixed(2) : '—'],
      ['AHE 3m annualised', pct(wage)],
      claims ? ['Initial claims, 4wk avg', `${claims.icsa_4w.toFixed(0)}k`] : null,
    ].filter(Boolean),
  }
}

function growthRead(monthly, index, quarterly, nowcasts) {
  const now = nowcasts?.gdpnow
  const retail = valueAt(monthly, 'retail_mom', index)
  const retail3 = [0, 1, 2].map((k) => monthsAgo(monthly, 'retail_mom', k, index)).filter(has)
  const retailAvg = retail3.length === 3 ? retail3.reduce((a, b) => a + b, 0) / 3 : null
  const ip = valueAt(monthly, 'ip', index)
  const philly = valueAt(monthly, 'philly', index)
  const empire = valueAt(monthly, 'empire', index)
  const surveys = [philly, empire].filter(has)
  const surveyAvg = surveys.length ? surveys.reduce((a, b) => a + b, 0) / surveys.length : null
  const lastGdp = lastWith(quarterly, 'gdp_growth')

  let tone = 'neutral'
  let headline
  const g = now?.value
  if (has(g)) {
    headline = `GDPNow ${pct(g)} for ${now.quarter}`
    if (g >= 2.5) { tone = 'hawkish'; headline += ', above-trend pace' }
    else if (g < 1) { tone = 'dovish'; headline += ', well below trend' }
    else headline += ', around trend'
  } else {
    headline = `Industrial production ${pct(ip)} y/y`
  }

  return {
    id: 'growth',
    label: 'Growth',
    tone,
    date: now?.quarter ?? lastWith(monthly, 'ip', index)?.date,
    headline,
    rule: 'Hawkish if GDPNow ≥2.5% annualised; dovish if <1%. (Trend growth is taken as roughly 1.75–2%.) Regional surveys stand in for ISM, which is licensed.',
    metrics: [
      lastGdp ? [`Real GDP ${lastGdp.quarter} (q/q ann.)`, pct(lastGdp.gdp_growth)] : null,
      ['Retail sales m/m (3m avg)', has(retailAvg) ? pct(retailAvg, 2) : pct(retail, 2)],
      ['Industrial production y/y', pct(ip)],
      ['Philly / Empire mfg', `${has(philly) ? philly.toFixed(1) : '—'} / ${has(empire) ? empire.toFixed(1) : '—'}`],
      has(surveyAvg) ? ['Regional survey average', surveyAvg.toFixed(1)] : null,
    ].filter(Boolean),
  }
}

export function pricedPath(meta, daily) {
  const pricing = meta?.policy_pricing
  if (pricing?.source === 'refinitiv' && pricing.meetings?.length) {
    const next = pricing.meetings[0]
    const in12 = pricing.meetings.filter((m) => {
      const d = new Date(`${m.date}T00:00:00Z`)
      return d - Date.now() <= 366 * 86400000
    })
    const last = in12[in12.length - 1] ?? next
    return {
      source: 'refinitiv',
      nextDate: next.date,
      nextBp: next.change_bp,
      twelveMonthBp: last.cumulative_bp,
    }
  }
  const proxy = lastWith(daily, 'priced_12m_proxy')?.priced_12m_proxy ?? null
  return { source: 'proxy', nextDate: meta?.fomc?.next?.date ?? null, nextBp: null, twelveMonthBp: proxy }
}

function pricingRead(meta, daily) {
  const p = pricedPath(meta, daily)
  if (!has(p.twelveMonthBp)) return null
  let tone = 'neutral'
  if (p.twelveMonthBp <= -40) tone = 'dovish'
  else if (p.twelveMonthBp >= 15) tone = 'hawkish'

  const direction = p.twelveMonthBp < 0 ? 'easing' : 'tightening'
  const headline = `${bp(Math.abs(p.twelveMonthBp))
    .replace('+', '')} of ${direction} priced over 12 months${p.source === 'proxy' ? ' (bill-curve proxy)' : ''}`

  return {
    id: 'pricing',
    label: 'Policy pricing',
    tone,
    date: lastWith(daily, 'effr')?.date,
    headline,
    rule: 'Dovish if ≥40bp of cuts are priced over 12 months; hawkish if ≥15bp of hikes. Proxy = 1Y Treasury yield minus EFFR.',
    metrics: [
      ['Next FOMC', p.nextDate ?? '—'],
      p.source === 'refinitiv' ? ['Priced for next meeting', bp(p.nextBp)] : null,
      ['Priced over 12 months', bp(p.twelveMonthBp)],
      ['Source', p.source === 'refinitiv' ? 'Fed funds futures (Refinitiv)' : 'Proxy: 1Y bill − EFFR'],
    ].filter(Boolean),
  }
}

function curveRead(daily) {
  const last = lastWith(daily, 'ust_10y')
  if (!last) return null
  const d10 = has(daysAgo(daily, 'ust_10y', 30)) ? (last.ust_10y - daysAgo(daily, 'ust_10y', 30)) * 100 : null
  const tpRow = lastWith(daily, 'acm_tp10')
  const tp1m = tpRow ? daysAgo(daily, 'acm_tp10', 30) : null
  const dtp = tpRow && has(tp1m) ? (tpRow.acm_tp10 - tp1m) * 100 : null
  const s = last.s2s10

  let headline = `10Y ${pct(last.ust_10y, 2)}, ${bp(d10)} over the past month`
  if (has(dtp) && has(d10) && Math.abs(d10) >= 5) {
    const share = Math.round((dtp / d10) * 100)
    headline += `; term premium ${bp(dtp)}${share >= 0 && share <= 200 ? ` (≈${share}% of the move)` : ''}`
  }
  const tone = has(s) ? (s < 0 ? 'hawkish' : 'neutral') : 'unclear'
  return {
    id: 'curve',
    label: 'Treasury curve',
    tone,
    date: last.date,
    headline,
    rule: 'Tagged hawkish only while 2s10s is inverted (policy restrictive relative to long rates). The term-premium split uses the ACM model, which is published with a lag.',
    metrics: [
      ['2s10s', bp(last.s2s10)],
      ['5s30s', bp(last.s5s30)],
      tpRow ? [`ACM 10Y term premium (${tpRow.date})`, pct(tpRow.acm_tp10, 2)] : null,
      tpRow ? ['Expected path component', pct(tpRow.acm_rn10, 2)] : null,
    ].filter(Boolean),
  }
}

function positioningRead(positioning) {
  const agg = positioning?.aggregate?.ust_lev_dv01
  if (!agg) return null
  const z = agg.z
  let tone = 'neutral'
  let headline = `Leveraged funds net ${agg.latest.toFixed(1)} $m/bp in UST futures`
  if (has(z) && Math.abs(z) >= 1.5) {
    tone = 'unclear'
    headline += ` — crowded (${z.toFixed(1)}σ vs 3y, ${agg.pctile}th pct)`
  } else if (has(z)) {
    headline += ` (${z.toFixed(1)}σ vs 3y)`
  }
  const am = positioning?.aggregate?.ust_am_dv01
  return {
    id: 'positioning',
    label: 'Positioning',
    tone,
    date: positioning?.as_of,
    headline,
    rule: 'Flags "crowded" when the aggregate leveraged-fund DV01 is ≥1.5 standard deviations from its 3-year mean. Positioning isn\'t directional for the Fed, so it carries no hawk/dove tag.',
    metrics: [
      ['Lev funds z-score (3y)', has(z) ? z.toFixed(2) : '—'],
      am ? ['Asset managers ($m/bp)', am.latest.toFixed(1)] : null,
      am ? ['Asset managers z-score', has(am.z) ? am.z.toFixed(2) : '—'] : null,
    ].filter(Boolean),
  }
}

/** All reads at a monthly focus index, plus a one-paragraph summary. */
export function buildFedWatch({ monthly, daily, weekly, meta, positioning, focusIndex }) {
  const index = focusIndex ?? monthly.length - 1
  const reads = [
    inflationRead(monthly, index, meta?.nowcasts?.cleveland),
    labourRead(monthly, index, weekly),
    growthRead(monthly, index, meta?.quarterly ?? [], meta?.nowcasts),
    pricingRead(meta, daily),
    curveRead(daily),
    positioningRead(positioning),
  ].filter(Boolean)

  const macro = reads.filter((r) => ['inflation', 'labour', 'growth'].includes(r.id))
  const score = macro.reduce((s, r) => s + (r.tone === 'hawkish' ? 1 : r.tone === 'dovish' ? -1 : 0), 0)
  const stance = score >= 2 ? 'hawkish' : score <= -2 ? 'dovish' : 'neutral'

  const pricing = reads.find((r) => r.id === 'pricing')
  let tension = ''
  if (pricing && stance !== 'neutral' && pricing.tone !== 'neutral' && pricing.tone !== stance) {
    tension = ` Market pricing leans ${pricing.tone} against that — the gap is where the risk sits.`
  } else if (pricing) {
    tension = ` Market pricing: ${pricing.headline}.`
  }

  const summary = `${macro.map((r) => `${r.label}: ${r.headline}.`).join(' ')}${tension}`
  return { reads, stance, summary, month: monthly[index]?.date }
}
