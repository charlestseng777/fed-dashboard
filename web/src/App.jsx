import { useMemo, useState } from 'react'
import { useData } from './lib/useData.js'
import { axisTick, axisTickDay, bp, dayLong, dayShort, monthLong, monthShort, pct, pp } from './lib/format.js'
import {
  BREAKEVEN_SERIES, CONTRACT_COLORS, CURVE_SERIES, NEAR_TERM_SERIES, GROWTH_SERIES, INFLATION_SERIES, LABOUR_SERIES,
  PALETTE, POSITIONING_SERIES, PRICED_SERIES, TERM_PREMIUM_SERIES, YIELD_SERIES,
} from './lib/series.js'
import { lastWith, pricedPath } from './lib/fedwatch.js'
import SeriesChart from './components/SeriesChart.jsx'
import RangeSlider, { startIndexFor } from './components/RangeSlider.jsx'
import {
  FedNewsCard, FedWatchCard, NotesCard, NowcastCard, Scorecard, StatCards, UpcomingReleasesCard,
} from './components/Cards.jsx'
import {
  AuctionsTable, CurveSnapshot, PolicyPathTable, PositioningTable, SofrOisTable,
} from './components/Tables.jsx'

const TABS = [
  { id: 'macro', label: 'Macro: inflation, labour, growth' },
  { id: 'rates', label: 'Rates & policy pricing' },
  { id: 'positioning', label: 'Positioning & flows' },
]

const DEFAULT_FROM = '2021-01'

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </div>
  )
}

function useWindow(rows, from = DEFAULT_FROM) {
  const [range, setRange] = useState(null)
  const effective = useMemo(() => {
    if (range) return range
    if (!rows.length) return [0, 0]
    return [startIndexFor(rows, from), rows.length - 1]
  }, [range, rows, from])
  const view = useMemo(() => rows.slice(effective[0], effective[1] + 1), [rows, effective])
  return { range: effective, setRange, view }
}

const pctTick = (v) => `${v}%`
const bpTick = (v) => `${v}bp`

export default function App() {
  const state = useData()
  const [tab, setTab] = useState('macro')
  const [clickedMonth, setClickedMonth] = useState(null)

  const monthly = state.monthly ?? []
  const daily = state.daily ?? []
  const weekly = state.weekly ?? []
  const posWeekly = state.positioning?.weekly ?? []
  const meta = state.meta ?? {}

  const m = useWindow(monthly)
  const d = useWindow(daily)
  const p = useWindow(posWeekly)

  const focusIndex = useMemo(() => {
    if (clickedMonth) {
      const i = monthly.findIndex((row) => row.date === clickedMonth)
      if (i >= 0) return i
    }
    return m.range[1]
  }, [clickedMonth, monthly, m.range])

  // Claims are weekly; show them over the same window as the monthly charts.
  const claimsView = useMemo(() => {
    const from = m.view[0]?.date
    const to = m.view[m.view.length - 1]?.date
    if (!from) return weekly
    return weekly.filter((row) => row.date.slice(0, 7) >= from && row.date.slice(0, 7) <= to)
  }, [weekly, m.view])

  const pricedFull = useMemo(() => {
    const hist = meta.policy_pricing?.priced_12m_history
    const useFutures = meta.policy_pricing?.source === 'refinitiv' && hist && Object.keys(hist).length
    return daily.map((row) => ({
      date: row.date,
      priced_12m: useFutures ? hist[row.date] ?? null : row.priced_12m_proxy ?? null,
    }))
  }, [daily, meta.policy_pricing])
  const pricedView = useMemo(() => pricedFull.slice(d.range[0], d.range[1] + 1), [pricedFull, d.range])

  const contractSeries = useMemo(() => (state.positioning?.contracts ?? []).map((c) => ({
    id: `${c.id}_lev`,
    label: `${c.label} — leveraged funds net`,
    short: c.label,
    color: CONTRACT_COLORS[c.id],
    width: 1.75,
    on: ['sr3', 'tu', 'ty'].includes(c.id),
  })), [state.positioning])

  if (state.status === 'loading') {
    return (
      <Shell>
        <div className="flex h-[60vh] items-center justify-center text-sm text-muted">Loading Fed, Treasury and CFTC data…</div>
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <div className="card card-pad mx-auto mt-16 max-w-lg">
          <h1 className="text-sm font-semibold text-ink">Could not load the data</h1>
          <p className="mt-2 text-xs leading-relaxed text-muted">{state.error}</p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-hairline bg-canvas p-3 text-[11px] text-muted">
python fetcher/fetch.py{'\n'}npm --prefix web run dev
          </pre>
        </div>
      </Shell>
    )
  }

  const latestM = lastWith(monthly, 'core_pce') ?? monthly[monthly.length - 1]
  const snap = meta.snapshot ?? {}
  const priced = pricedPath(meta, daily)
  const agg = state.positioning?.aggregate ?? {}
  const lastAuction = meta.auctions?.recent?.[0]
  const nextMeeting = meta.fomc?.next
  const decisions = meta.fomc?.decisions ?? []
  const events = meta.events ?? []

  const change = (key) => lastWith(monthly, key)?.mom?.[key] ?? null
  const snapBp = (key, scale = 100) => (snap[key]?.chg_1w === null || snap[key]?.chg_1w === undefined ? null : snap[key].chg_1w * scale)

  const CARDS = {
    macro: [
      { id: 'core_pce', label: 'Core PCE', color: PALETTE.blue, value: lastWith(monthly, 'core_pce')?.core_pce, unit: '% y/y', change: change('core_pce'), changeFormat: (v) => pp(v), changeLabel: 'on the month', note: `The Fed's target measure · ${monthLong(lastWith(monthly, 'core_pce')?.date)}` },
      { id: 'core_cpi', label: 'Core CPI', color: PALETTE.aqua, value: lastWith(monthly, 'core_cpi')?.core_cpi, unit: '% y/y', change: change('core_cpi'), changeFormat: (v) => pp(v), changeLabel: 'on the month', note: `3m annualised ${pct(lastWith(monthly, 'core_cpi_3m')?.core_cpi_3m)} · ${monthLong(lastWith(monthly, 'core_cpi')?.date)}` },
      { id: 'unemployment', label: 'Unemployment', color: PALETTE.orange, value: lastWith(monthly, 'unemployment')?.unemployment, digits: 1, unit: '%', change: change('unemployment'), changeFormat: (v) => pp(v, 1), changeLabel: 'on the month', note: `Payrolls ${lastWith(monthly, 'payrolls')?.payrolls ?? '—'}k · ${monthLong(lastWith(monthly, 'unemployment')?.date)}` },
      { id: 'ff', label: 'Fed funds target', color: PALETTE.neutral, value: snap.ff_upper?.value, unit: `% (${snap.ff_lower?.value?.toFixed(2) ?? '—'}–${snap.ff_upper?.value?.toFixed(2) ?? '—'})`, change: priced.twelveMonthBp, changeFormat: (v) => bp(v), changeLabel: 'priced over 12m', note: nextMeeting ? `Next FOMC ${dayLong(nextMeeting.date)}${nextMeeting.sep ? ' (SEP)' : ''}` : 'Upper bound of the target range' },
    ],
    rates: [
      { id: 'ust_2y', label: '2Y Treasury', color: PALETTE.blue, value: snap.ust_2y?.value, unit: '%', change: snapBp('ust_2y'), changeFormat: (v) => bp(v, 1), changeLabel: 'on the week', note: 'Most sensitive to the policy path' },
      { id: 'ust_10y', label: '10Y Treasury', color: PALETTE.orange, value: snap.ust_10y?.value, unit: '%', change: snapBp('ust_10y'), changeFormat: (v) => bp(v, 1), changeLabel: 'on the week', note: `Real ${pct(snap.real_10y?.value, 2)} + breakeven ${pct(snap.be_10y?.value, 2)}` },
      { id: 's2s10', label: '2s10s', color: PALETTE.aqua, value: snap.s2s10?.value, digits: 1, unit: 'bp', change: snapBp('s2s10', 1), changeFormat: (v) => bp(v, 1), changeLabel: 'on the week', note: `5s30s ${bp(snap.s5s30?.value, 1)}` },
      { id: 'acm', label: 'ACM 10Y term premium', color: PALETTE.yellow, value: snap.acm_tp10?.value, unit: '%', change: snapBp('acm_tp10'), changeFormat: (v) => bp(v, 1), changeLabel: 'on the week', note: snap.acm_tp10?.date ? `As of ${dayLong(snap.acm_tp10.date)} (published with a lag)` : 'NY Fed ACM model' },
    ],
    positioning: [
      { id: 'lev', label: 'Lev funds UST DV01', color: PALETTE.blue, value: agg.ust_lev_dv01?.latest, digits: 1, unit: '$m/bp', change: agg.ust_lev_dv01?.z, changeFormat: (v) => (v === null || v === undefined ? '—' : `${v.toFixed(2)}σ`), changeLabel: 'vs 3y mean', note: 'Net, across 2Y–Ultra bond futures' },
      { id: 'am', label: 'Asset mgr UST DV01', color: PALETTE.orange, value: agg.ust_am_dv01?.latest, digits: 1, unit: '$m/bp', change: agg.ust_am_dv01?.z, changeFormat: (v) => (v === null || v === undefined ? '—' : `${v.toFixed(2)}σ`), changeLabel: 'vs 3y mean', note: `CFTC week of ${dayLong(state.positioning?.as_of)}` },
      { id: 'btc', label: 'Last auction bid/cover', color: PALETTE.aqua, value: lastAuction?.btc, unit: '×', change: lastAuction && lastAuction.btc_avg6 !== null ? lastAuction.btc - lastAuction.btc_avg6 : null, changeFormat: (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`), changeLabel: 'vs 6-auction avg', note: lastAuction ? `${lastAuction.term} · ${dayLong(lastAuction.date)}` : 'Treasury Fiscal Data' },
      { id: 'sofr', label: 'SOFR', color: PALETTE.yellow, value: snap.sofr?.value, unit: '%', change: snap.sofr?.value !== undefined && snap.effr?.value !== undefined ? (snap.sofr.value - snap.effr.value) * 100 : null, changeFormat: (v) => bp(v, 0), changeLabel: 'vs EFFR', note: 'Repo funding pressure shows up here first' },
    ],
  }

  return (
    <Shell>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">Fed Dashboard</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Is inflation converging, is the labour market loosening, and what is the market
            pricing the FOMC to do about it? Click any month on a chart to re-read the Fed
            watch panel at that point.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span>Latest inflation data <span className="num text-ink">{monthLong(latestM?.date)}</span></span>
            <span>Latest market close <span className="num text-ink">{dayLong(meta.latest_daily)}</span></span>
            <span>Real policy rate <span className="num text-ink">{pp(lastWith(monthly, 'real_rate')?.real_rate)}</span></span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <nav className="flex flex-wrap justify-end gap-1.5" aria-label="Views">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={tab === entry.id ? 'page' : undefined}
                onClick={() => setTab(entry.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === entry.id ? 'border-white/25 bg-white/[0.07] text-ink' : 'border-hairline text-muted hover:border-white/20 hover:text-ink'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          {state.generatedAt && (
            <span className="text-[10px] text-faint">
              Data refreshed {new Date(state.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
            </span>
          )}
        </div>
      </header>

      <div className="space-y-4">
        <StatCards cards={CARDS[tab]} />

        {tab === 'macro' && (
          <>
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="lg:col-span-3">
                <SeriesChart
                  title="Inflation and the policy rate"
                  subtitle="Core PCE (the Fed's target measure) and CPI measures against the Fed funds target, percent y/y. Click any month to focus the Fed watch panel."
                  data={m.view}
                  series={INFLATION_SERIES}
                  syncId="macro"
                  xFormat={axisTick}
                  tooltipDate={monthLong}
                  leftFormat={pctTick}
                  valueFormat={(v) => pct(v, 2)}
                  refLines={[{ y: 2, label: '2% target' }]}
                  events={events}
                  decisions={decisions}
                  onSelect={setClickedMonth}
                  selected={clickedMonth}
                  height="h-[360px] sm:h-[420px]"
                  header={<RangeSlider rows={monthly} range={m.range} onChange={m.setRange} format={monthShort} unit="months" />}
                />
              </div>
              {/* Same trick as the UK dashboard: take this column out of flow at
                  lg+ so the row height is set by the chart alone. */}
              <div className="lg:relative lg:col-span-1">
                <div className="flex min-h-0 flex-col gap-3 lg:absolute lg:inset-0">
                  <FedWatchCard state={state} focusIndex={focusIndex} className="flex-1 min-h-0" />
                  <UpcomingReleasesCard releases={meta.upcoming_releases} className="flex-1 min-h-0" />
                </div>
              </div>
            </div>

            <Scorecard state={state} focusIndex={focusIndex} />

            <div className="grid gap-3 xl:grid-cols-2">
              <SeriesChart
                title="Labour market"
                subtitle="Payroll changes (bars, thousands, right axis) against the unemployment rate. Toggle wages, openings and the V/U ratio on."
                data={m.view}
                fullData={monthly}
                series={LABOUR_SERIES}
                syncId="macro"
                xFormat={axisTick}
                tooltipDate={monthLong}
                leftFormat={(v) => `${v}`}
                rightFormat={(v) => `${v}k`}
                valueFormat={(v) => v.toFixed(2)}
                onSelect={setClickedMonth}
                selected={clickedMonth}
              />
              <SeriesChart
                title="Weekly jobless claims"
                subtitle="Initial claims and 4-week average (left), continuing claims (right), thousands. The timeliest labour-market signal."
                data={claimsView}
                fullData={weekly}
                series={[
                  { id: 'icsa', label: 'Initial claims (k)', short: 'Initial', color: PALETTE.blue, width: 1.25, locked: true },
                  { id: 'icsa_4w', label: 'Initial claims, 4wk avg (k)', short: '4wk avg', color: PALETTE.orange, width: 2.25, locked: true },
                  { id: 'ccsa', label: 'Continuing claims (k)', short: 'Continuing', color: PALETTE.aqua, width: 1.75, axis: 'right', on: true },
                ]}
                xFormat={axisTickDay}
                tooltipDate={dayLong}
                leftFormat={(v) => `${v}k`}
                rightFormat={(v) => `${(v / 1000).toFixed(1)}m`}
                valueFormat={(v) => `${v.toFixed(0)}k`}
              />
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <SeriesChart
                title="Activity"
                subtitle="Retail sales and industrial production (% y/y, left); Philly and Empire State manufacturing surveys (diffusion index, right) as a free stand-in for ISM."
                data={m.view}
                fullData={monthly}
                series={GROWTH_SERIES}
                syncId="macro"
                xFormat={axisTick}
                tooltipDate={monthLong}
                leftFormat={pctTick}
                valueFormat={(v) => v.toFixed(1)}
                refLines={[{ y: 0, solid: true, color: '#2E3545' }]}
                onSelect={setClickedMonth}
                selected={clickedMonth}
              />
              <NowcastCard nowcasts={meta.nowcasts} quarterly={meta.quarterly} />
            </div>
          </>
        )}

        {tab === 'rates' && (
          <>
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="lg:col-span-3">
                <SeriesChart
                  title="Treasury yields and the policy rate"
                  subtitle="Constant-maturity Treasury yields against the Fed funds target and SOFR, percent, daily."
                  data={d.view}
                  series={YIELD_SERIES}
                  syncId="rates"
                  xFormat={axisTickDay}
                  tooltipDate={dayLong}
                  leftFormat={pctTick}
                  valueFormat={(v) => pct(v, 2)}
                  events={events}
                  decisions={decisions}
                  height="h-[360px] sm:h-[420px]"
                  header={<RangeSlider rows={daily} range={d.range} onChange={d.setRange} format={dayShort} unit="days" />}
                />
              </div>
              <div className="lg:relative lg:col-span-1">
                <div className="flex min-h-0 flex-col gap-3 lg:absolute lg:inset-0">
                  <FedWatchCard state={state} focusIndex={monthly.length - 1} className="flex-1 min-h-0" />
                  <FedNewsCard news={meta.fed_news} className="flex-1 min-h-0" />
                </div>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <PolicyPathTable pricing={meta.policy_pricing} meetings={meta.fomc?.meetings} />
              <SeriesChart
                title="How much the market prices over 12 months"
                subtitle={meta.policy_pricing?.source === 'refinitiv'
                  ? 'Change in the policy rate priced over the Fed funds futures strip, bp. Negative = cuts.'
                  : 'Proxy: 1Y Treasury yield minus EFFR, bp. Negative = cuts priced. Add Refinitiv credentials for the futures-based series.'}
                data={pricedView}
                fullData={pricedFull}
                series={PRICED_SERIES}
                syncId="rates"
                xFormat={axisTickDay}
                tooltipDate={dayLong}
                leftFormat={bpTick}
                valueFormat={(v) => bp(v, 1)}
                refLines={[{ y: 0, solid: true, color: '#2E3545' }]}
                decisions={decisions}
              />
            </div>

            <SofrOisTable pricing={meta.policy_pricing} />

            <SeriesChart
              title="Policy expectations vs term premium"
              subtitle="The NY Fed's ACM model splits the 10Y yield into the expected path of short rates and a term premium (right axis) — separating 'the Fed will do more/less' from 'investors want more compensation for duration'."
              data={d.view}
                fullData={daily}
              series={TERM_PREMIUM_SERIES}
              syncId="rates"
              xFormat={axisTickDay}
              tooltipDate={dayLong}
              leftFormat={pctTick}
              valueFormat={(v) => pct(v, 2)}
              decisions={decisions}
              footer={<p className="text-xs text-faint">ACM data are published with a lag of up to a few weeks; the Kim-Wright (Fed Board) term premium is available as a cross-check.</p>}
            />

            <div className="grid gap-3 xl:grid-cols-2">
              <SeriesChart
                title="Curve spreads"
                subtitle="2s10s and 5s30s, basis points. Bull steepening usually means cuts being priced; bear steepening often means term premium."
                data={d.view}
                fullData={daily}
                series={CURVE_SERIES}
                syncId="rates"
                xFormat={axisTickDay}
                tooltipDate={dayLong}
                leftFormat={bpTick}
                valueFormat={(v) => bp(v, 1)}
                refLines={[{ y: 0, solid: true, color: '#4A5468' }]}
                decisions={decisions}
                showLatest
              />
              <SeriesChart
                title="Near-term policy and inflation expectations"
                subtitle="The 1y1y Treasury forward (the 1-year rate one year ahead: where the market sees policy settling after the next year) and 2Y breakeven inflation, percent, from the Fed Board's fitted Treasury and TIPS curves (refreshed roughly weekly). Switch on 1Y / 2Y SOFR OIS (Refinitiv) or Fed funds to compare."
                data={d.view}
                fullData={daily}
                series={NEAR_TERM_SERIES}
                syncId="rates"
                xFormat={axisTickDay}
                tooltipDate={dayLong}
                leftFormat={pctTick}
                valueFormat={(v) => pct(v, 2)}
                refLines={[{ y: 2, label: '2% target' }]}
                decisions={decisions}
                showLatest
              />
            </div>

            <SeriesChart
              title="Inflation compensation"
              subtitle="TIPS breakevens and the 10Y real yield (percent, left), with gold ($/oz, right; COMEX front-month futures via Yahoo Finance, or spot XAU/USD if Yahoo is unavailable) as a market-based inflation hedge. The 5y5y forward is the market's read on long-run inflation expectations."
              data={d.view}
              fullData={daily}
              series={BREAKEVEN_SERIES}
              syncId="rates"
              xFormat={axisTickDay}
              tooltipDate={dayLong}
              leftFormat={pctTick}
              rightFormat={(v) => `$${v.toLocaleString()}`}
              valueFormat={(v) => pct(v, 2)}
              refLines={[{ y: 2, label: '2%' }]}
            />

            <CurveSnapshot snapshot={snap} />
          </>
        )}

        {tab === 'positioning' && (
          <>
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="lg:col-span-3">
                <SeriesChart
                  title="Positioning in Treasury futures (risk-weighted)"
                  subtitle="Net DV01 across 2Y–Ultra bond futures, $ millions per basis point, weekly. Leveraged funds' short is largely the basis trade against asset managers' long."
                  data={p.view}
                  series={POSITIONING_SERIES}
                  syncId="positioning"
                  xFormat={axisTickDay}
                  tooltipDate={dayLong}
                  leftFormat={(v) => `${v}`}
                  valueFormat={(v) => `${v.toFixed(1)} $m/bp`}
                  refLines={[{ y: 0, solid: true, color: '#2E3545' }]}
                  height="h-[360px] sm:h-[420px]"
                  header={<RangeSlider rows={posWeekly} range={p.range} onChange={p.setRange} format={dayShort} unit="weeks" />}
                />
              </div>
              <div className="lg:relative lg:col-span-1">
                <div className="flex min-h-0 flex-col gap-3 lg:absolute lg:inset-0">
                  <NotesCard notes={meta.notes} className="flex-1 min-h-0" />
                  <UpcomingReleasesCard releases={meta.upcoming_releases} className="flex-1 min-h-0" />
                </div>
              </div>
            </div>

            <SeriesChart
              title="Leveraged-fund net positions by contract"
              subtitle="Net contracts (long minus short), weekly. STIR futures (Fed funds, SOFR) show bets on the policy path directly."
              data={p.view}
                fullData={posWeekly}
              series={contractSeries}
              syncId="positioning"
              xFormat={axisTickDay}
              tooltipDate={dayLong}
              leftFormat={(v) => `${(v / 1000).toFixed(0)}k`}
              valueFormat={(v) => `${(v / 1000).toFixed(1)}k`}
              refLines={[{ y: 0, solid: true, color: '#2E3545' }]}
            />

            <PositioningTable positioning={state.positioning} />
            <AuctionsTable auctions={meta.auctions} />
          </>
        )}

        <Footer meta={meta} />
      </div>
    </Shell>
  )
}

const SOURCE_LABELS = {
  'nyfed:acm': 'NY Fed ACM term premium',
  'clevelandfed:nowcast': 'Cleveland Fed nowcast',
  'refinitiv:policy_pricing': 'Refinitiv futures / OIS',
  'fedboard:gsw': 'Fed Board fitted curves (1y1y, 2Y BE)',
  'refinitiv:ois_history': 'Refinitiv SOFR OIS history',
  'yahoo:gold': 'Gold (Yahoo Finance)',
  'stooq:gold': 'Gold (Stooq fallback)',
  'cftc:tff': 'CFTC positioning',
  'treasury:auctions': 'Treasury auctions',
  'fed:news': 'Fed news feeds',
  calendars: 'Release calendars',
  'fed:fomc_calendar': 'FOMC calendar',
}

function Footer({ meta }) {
  const status = meta.sources ?? {}
  const fredFails = Object.entries(status).filter(([k, v]) => k.startsWith('fred:') && !v.ok).map(([k]) => k.slice(5))
  const other = Object.entries(SOURCE_LABELS).map(([k, label]) => ({ k, label, ok: status[k]?.ok, error: status[k]?.error }))
  return (
    <footer className="card card-pad text-[11px] leading-relaxed text-faint">
      <div className="label-xs mb-2">Sources and status this run</div>
      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded border px-2 py-0.5 ${fredFails.length ? 'border-[#E9B872]/40 text-[#E9B872]' : 'border-hairline text-muted'}`}>
          FRED (BLS, BEA, Fed Board, Census) {fredFails.length ? `· ${fredFails.length} series stale: ${fredFails.join(', ')}` : '· ok'}
        </span>
        {other.map((s) => (
          <span
            key={s.k}
            title={s.error ?? ''}
            className={`rounded border px-2 py-0.5 ${s.ok ? 'border-hairline text-muted' : 'border-[#E9B872]/40 text-[#E9B872]'}`}
          >
            {s.label} · {s.ok ? 'ok' : s.k === 'refinitiv:policy_pricing' && s.error === 'no credentials configured' ? 'not configured (proxy used)' : 'stale'}
          </span>
        ))}
      </div>
      <p className="mt-3 max-w-4xl">
        Refreshed each weekday by GitHub Actions. A source that fails keeps its previous
        values and is flagged above. ISM, CME FedWatch and dealer research are licensed and not
        scraped; regional Fed surveys, a bill-curve proxy (or Refinitiv, if configured) and a hand-kept
        notes file stand in. Not investment advice.
      </p>
    </footer>
  )
}
