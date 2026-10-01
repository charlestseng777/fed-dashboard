import { bp, contracts, dayLong, dayShort, pct } from '../lib/format.js'
import { CONTRACT_COLORS } from '../lib/series.js'

function Th({ children, right }) {
  return <th className={`px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-faint ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({ children, right, className = '' }) {
  return <td className={`px-3 py-2 text-xs ${right ? 'num text-right' : ''} ${className}`}>{children}</td>
}

const toneOf = (v) => (v === null || v === undefined || v === 0 ? 'text-faint' : v > 0 ? 'text-[#E9B872]' : 'text-[#7FB9E8]')

function Table({ title, subtitle, children, footer }) {
  return (
    <section className="card" aria-label={title}>
      <header className="border-b border-hairline px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 max-w-3xl text-xs text-muted">{subtitle}</p>}
      </header>
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[560px] border-collapse">{children}</table>
      </div>
      {footer && <footer className="border-t border-hairline px-4 py-3 text-[11px] leading-relaxed text-faint sm:px-5">{footer}</footer>}
    </section>
  )
}

/** Treasury curve snapshot with 1w / 1m changes. */
export function CurveSnapshot({ snapshot }) {
  const rows = [
    ['ust_2y', '2Y', 'yield'], ['ust_5y', '5Y', 'yield'], ['ust_10y', '10Y', 'yield'], ['ust_30y', '30Y', 'yield'],
    ['s2s10', '2s10s', 'spread'], ['s5s30', '5s30s', 'spread'],
    ['acm_tp10', 'ACM 10Y term premium', 'yield'], ['acm_rn10', 'ACM 10Y expected path', 'yield'],
    ['fwd_1y1y', '1y1y Treasury forward', 'yield'], ['be_2y', '2Y breakeven', 'yield'],
    ['ois_1y', '1Y SOFR OIS', 'yield'], ['ois_2y', '2Y SOFR OIS', 'yield'],
    ['be_5y', '5Y breakeven', 'yield'], ['be_5y5y', '5y5y breakeven', 'yield'], ['real_10y', '10Y real (TIPS)', 'yield'],
    ['sofr', 'SOFR', 'yield'], ['effr', 'EFFR', 'yield'],
  ]
  return (
    <Table
      title="Treasury market snapshot"
      subtitle="Latest close and change, in basis points. Spreads are already in bp."
      footer="Yields are constant-maturity (H.15). The ACM model splits the 10Y yield into the expected average short rate and a term premium; it is published with a lag, so its date may trail the yields."
    >
      <thead className="border-b border-hairline">
        <tr><Th>Instrument</Th><Th right>Level</Th><Th right>1 week</Th><Th right>1 month</Th><Th right>As of</Th></tr>
      </thead>
      <tbody>
        {rows.map(([id, label, kind]) => {
          const s = snapshot?.[id]
          if (!s || s.value === null || s.value === undefined) return null
          const scale = kind === 'spread' ? 1 : 100
          const w = s.chg_1w === null ? null : s.chg_1w * scale
          const m = s.chg_1m === null ? null : s.chg_1m * scale
          return (
            <tr key={id} className="border-b border-hairline/60 last:border-0">
              <Td className="text-ink">{label}</Td>
              <Td right className="text-ink">{kind === 'spread' ? bp(s.value, 1) : pct(s.value, 2)}</Td>
              <Td right className={toneOf(w)}>{bp(w, 1)}</Td>
              <Td right className={toneOf(m)}>{bp(m, 1)}</Td>
              <Td right className="text-faint">{dayShort(s.date)}</Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

/** Policy path: meeting-by-meeting (futures) or the bill-curve proxy. */
export function PolicyPathTable({ pricing, meetings }) {
  if (!pricing) return null
  if (pricing.source === 'refinitiv' && pricing.meetings?.length) {
    return (
      <Table
        title="Market-implied FOMC path"
        subtitle={`Fed funds futures, meeting by meeting, from a reference EFFR of ${pct(pricing.reference_rate, 2)}.`}
        footer="Derived from 30-day Fed funds futures (Refinitiv) with the standard month-average decomposition: a contract settles on the month's average EFFR, split into pre- and post-meeting days."
      >
        <thead className="border-b border-hairline">
          <tr><Th>Meeting</Th><Th right>Implied rate</Th><Th right>Change</Th><Th right>Cumulative</Th><Th right>Cuts/hikes priced</Th></tr>
        </thead>
        <tbody>
          {pricing.meetings.map((m) => (
            <tr key={m.date} className="border-b border-hairline/60 last:border-0">
              <Td className="text-ink">{dayLong(m.date)}{meetings?.find((x) => x.date === m.date)?.sep ? ' · SEP' : ''}</Td>
              <Td right className="text-ink">{pct(m.implied_rate, 3)}</Td>
              <Td right className={toneOf(m.change_bp)}>{bp(m.change_bp, 1)}</Td>
              <Td right className={toneOf(m.cumulative_bp)}>{bp(m.cumulative_bp, 1)}</Td>
              <Td right className="text-muted">{(m.cumulative_bp / 25).toFixed(2)}×25bp</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    )
  }
  return (
    <Table
      title="Policy pricing (proxy)"
      subtitle={`No futures feed configured, so this reads the path off the Treasury bill curve against EFFR (${pct(pricing.reference_rate, 2)}).`}
      footer={pricing.note}
    >
      <thead className="border-b border-hairline">
        <tr><Th>Tenor</Th><Th right>Yield</Th><Th right>vs EFFR</Th><Th right>As of</Th></tr>
      </thead>
      <tbody>
        {(pricing.curve ?? []).map((p) => (
          <tr key={p.tenor} className="border-b border-hairline/60 last:border-0">
            <Td className="text-ink">{p.tenor}</Td>
            <Td right className="text-ink">{pct(p.rate, 2)}</Td>
            <Td right className={toneOf(p.vs_effr_bp)}>{bp(p.vs_effr_bp, 1)}</Td>
            <Td right className="text-faint">{dayShort(p.date)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

export function SofrOisTable({ pricing }) {
  const curve = pricing?.sofr_ois ?? []
  if (!curve.length) return null
  return (
    <Table title="SOFR OIS curve" subtitle={`Refinitiv ${pricing.method === 'historical' ? 'latest close' : 'snapshot'}, percent.`}>
      <thead className="border-b border-hairline"><tr><Th>Tenor</Th><Th right>Rate</Th><Th right>vs EFFR</Th></tr></thead>
      <tbody>
        {curve.map((p) => (
          <tr key={p.tenor} className="border-b border-hairline/60 last:border-0">
            <Td className="text-ink">{p.tenor}</Td>
            <Td right className="text-ink">{pct(p.rate, 3)}</Td>
            <Td right className={toneOf(p.rate - pricing.reference_rate)}>{bp((p.rate - pricing.reference_rate) * 100, 1)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** CFTC crowding table. */
export function PositioningTable({ positioning }) {
  const latest = positioning?.latest ?? []
  const zTone = (z) => (z === null || z === undefined ? 'text-faint' : Math.abs(z) >= 1.5 ? 'text-ink font-semibold' : 'text-muted')
  return (
    <Table
      title="Futures positioning & crowding"
      subtitle={`CFTC Traders in Financial Futures, week of ${positioning?.as_of ? dayLong(positioning.as_of) : '—'}. Net contracts; z-scores and percentiles against the past 3 years.`}
      footer="Leveraged funds are hedge funds and CTAs; asset managers are pension funds, insurers and mutual funds. |z| ≥ 1.5 is shown in bold as crowded. Much of the leveraged-fund short in Treasury futures is the cash–futures basis trade, the other side of asset managers' long, so read the two together."
    >
      <thead className="border-b border-hairline">
        <tr>
          <Th>Contract</Th><Th right>Lev funds net</Th><Th right>w/w</Th><Th right>z (3y)</Th><Th right>Pctile</Th>
          <Th right>Asset mgr net</Th><Th right>w/w</Th><Th right>z (3y)</Th><Th right>% OI (lev)</Th>
        </tr>
      </thead>
      <tbody>
        {latest.map((c) => (
          <tr key={c.id} className="border-b border-hairline/60 last:border-0">
            <Td className="text-ink">
              <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: CONTRACT_COLORS[c.id] }} aria-hidden="true" />
              {c.label}
            </Td>
            <Td right className="text-ink">{contracts(c.lev_net)}</Td>
            <Td right className={toneOf(c.lev_change)}>{contracts(c.lev_change)}</Td>
            <Td right className={zTone(c.lev_z)}>{c.lev_z?.toFixed(2) ?? '—'}</Td>
            <Td right className="text-muted">{c.lev_pctile ?? '—'}</Td>
            <Td right className="text-ink">{contracts(c.am_net)}</Td>
            <Td right className={toneOf(c.am_change)}>{contracts(c.am_change)}</Td>
            <Td right className={zTone(c.am_z)}>{c.am_z?.toFixed(2) ?? '—'}</Td>
            <Td right className="text-muted">{c.lev_pct_oi === null ? '—' : `${c.lev_pct_oi.toFixed(1)}%`}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** Treasury coupon auctions: recent results vs the 6-auction average, and the calendar. */
export function AuctionsTable({ auctions }) {
  const recent = auctions?.recent ?? []
  const upcoming = auctions?.upcoming ?? []
  const vs = (v, avg, digits = 2, invert = false) => {
    if (v === null || v === undefined || avg === null || avg === undefined) return null
    const d = v - avg
    // Stronger demand = higher bid-to-cover / indirect, lower dealer takedown.
    const strong = invert ? d < 0 : d > 0
    return <span className={Math.abs(d) < 0.05 ? 'text-faint' : strong ? 'text-[#7FB9E8]' : 'text-[#E9B872]'}>{d > 0 ? '+' : '−'}{Math.abs(d).toFixed(digits)}</span>
  }
  return (
    <Table
      title="Treasury coupon auctions"
      subtitle="Recent nominal coupon auctions against the average of the previous six at the same tenor, plus the announced calendar."
      footer="Blue = stronger demand than recent average (higher bid-to-cover or indirect share, lower dealer takedown); amber = weaker. The tail vs when-issued isn't published by Treasury, so it isn't shown. Source: Treasury Fiscal Data."
    >
      <thead className="border-b border-hairline">
        <tr>
          <Th>Auction</Th><Th right>Size</Th><Th right>High yield</Th><Th right>Bid/cover</Th><Th right>vs avg</Th>
          <Th right>Indirect</Th><Th right>vs avg</Th><Th right>Dealers</Th><Th right>vs avg</Th>
        </tr>
      </thead>
      <tbody>
        {upcoming.map((a) => (
          <tr key={`u-${a.date}-${a.term}`} className="border-b border-hairline/60 bg-white/[0.02]">
            <Td className="text-ink">{dayShort(a.date)} · {a.term}{a.reopening ? ' (reopen)' : ''} <span className="ml-1 text-[10px] text-faint">upcoming</span></Td>
            <Td right className="text-muted">{a.size_bn ? `$${a.size_bn}bn` : '—'}</Td>
            <Td right className="text-faint">—</Td><Td right /><Td right /><Td right /><Td right /><Td right /><Td right />
          </tr>
        ))}
        {recent.map((a) => (
          <tr key={`r-${a.date}-${a.term}`} className="border-b border-hairline/60 last:border-0">
            <Td className="text-ink">{dayShort(a.date)} · {a.term}{a.reopening ? ' (reopen)' : ''}</Td>
            <Td right className="text-muted">{a.size_bn ? `$${a.size_bn}bn` : '—'}</Td>
            <Td right className="text-ink">{pct(a.high_yield, 3)}</Td>
            <Td right className="text-ink">{a.btc?.toFixed(2) ?? '—'}</Td>
            <Td right>{vs(a.btc, a.btc_avg6)}</Td>
            <Td right className="text-ink">{a.indirect_pct === null ? '—' : `${a.indirect_pct.toFixed(1)}%`}</Td>
            <Td right>{vs(a.indirect_pct, a.indirect_pct_avg6, 1)}</Td>
            <Td right className="text-ink">{a.dealer_pct === null ? '—' : `${a.dealer_pct.toFixed(1)}%`}</Td>
            <Td right>{vs(a.dealer_pct, a.dealer_pct_avg6, 1, true)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
