import { useMemo } from 'react'
import { buildFedWatch } from '../lib/fedwatch.js'
import { TONE } from '../lib/series.js'
import { dayLong, deltaArrow, deltaTone, monthLong } from '../lib/format.js'

/**
 * Headline tiles. cards: [{ id, label, color, value, unit, change, changeLabel,
 * changeFormat, note, digits }]
 */
export function StatCards({ cards }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.id} className="card card-pad animate-fade-up">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: card.color }} aria-hidden="true" />
            <span className="label-xs">{card.label}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="num text-3xl font-semibold leading-none text-ink">
              {card.value === null || card.value === undefined ? '—' : card.value.toFixed(card.digits ?? 2)}
            </span>
            <span className="text-base text-faint">{card.unit}</span>
          </div>
          <div className={`mt-2 flex items-center gap-1.5 text-xs ${deltaTone(card.change)}`}>
            <span aria-hidden="true">{deltaArrow(card.change)}</span>
            <span className="num">{card.changeFormat(card.change)}</span>
            <span className="text-faint">{card.changeLabel}</span>
          </div>
          <div className="mt-1.5 text-[11px] leading-snug text-faint">{card.note}</div>
        </div>
      ))}
    </div>
  )
}

export function ToneBadge({ tone }) {
  const t = TONE[tone] ?? TONE.unclear
  return <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${t.className}`}>{t.label}</span>
}

/** Right-hand panel: the one-paragraph read at the focused month. */
export function FedWatchCard({ state, focusIndex, className = '' }) {
  const watch = useMemo(() => buildFedWatch({ ...state, focusIndex }), [state, focusIndex])
  return (
    <section className={`card card-pad flex min-h-0 flex-col ${className}`} aria-live="polite" aria-label="Fed watch">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="label-xs">Fed watch</div>
        <div className="flex items-center gap-2">
          <ToneBadge tone={watch.stance} />
          <span className="num text-[11px] text-faint">{monthLong(watch.month)}</span>
        </div>
      </div>
      <p key={watch.month} className="mt-3 min-h-0 flex-1 animate-fade-up overflow-y-auto pr-1 text-[13px] leading-relaxed text-ink scroll-thin">
        {watch.summary}
      </p>
      <p className="mt-3 border-t border-hairline pt-2.5 text-[10px] leading-relaxed text-faint">
        Rules-based: each category is tagged by the thresholds shown in the
        scorecard below. Click a month on a chart to re-read it at that point.
      </p>
    </section>
  )
}

/** Full scorecard: one tile per category, with the rule that tagged it. */
export function Scorecard({ state, focusIndex }) {
  const watch = useMemo(() => buildFedWatch({ ...state, focusIndex }), [state, focusIndex])
  return (
    <section className="card" aria-label="Fed watch scorecard">
      <header className="border-b border-hairline px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold text-ink">Fed watch scorecard</h2>
        <p className="mt-0.5 text-xs text-muted">
          What the FOMC is reacting to, category by category — and whether each is
          pushing toward tighter or easier policy under a stated rule.
        </p>
      </header>
      <div className="grid gap-px bg-hairline sm:grid-cols-2 xl:grid-cols-3">
        {watch.reads.map((r) => (
          <div key={r.id} className="bg-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="label-xs">{r.label}</span>
              <ToneBadge tone={r.tone} />
            </div>
            <p className="mt-2 text-[13px] leading-snug text-ink">{r.headline}</p>
            <dl className="mt-3 space-y-1">
              {r.metrics.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-xs">
                  <dt className="text-muted">{k}</dt>
                  <dd className="num text-right text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[10px] leading-relaxed text-faint">{r.rule}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function daysUntil(iso) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${iso}T00:00:00`) - today) / 86400000)
}

export function UpcomingReleasesCard({ releases, className = '' }) {
  const items = releases ?? []
  return (
    <section className={`card card-pad flex min-h-0 flex-col ${className}`} aria-label="Upcoming data">
      <div className="label-xs">Upcoming data</div>
      {items.length ? (
        <ul className="mt-2.5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 scroll-thin">
          {items.map((entry) => {
            const days = daysUntil(entry.date)
            const soon = days <= 3
            const label = days < 0 ? 'past' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`
            return (
              <li key={entry.id} className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs ${soon ? 'border-white/15 bg-white/[0.04]' : 'border-hairline'}`}>
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{entry.label}</div>
                  <div className="num mt-0.5 text-[10px] text-faint">{dayLong(entry.date)} · {entry.source}</div>
                </div>
                <span className={`num shrink-0 text-[11px] font-medium ${soon ? 'text-ink' : 'text-faint'}`}>{label}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2.5 flex-1 text-xs text-muted">No upcoming release dates available.</p>
      )}
      <p className="mt-3 border-t border-hairline pt-2.5 text-[10px] leading-relaxed text-faint">
        From the BLS and BEA release calendars and the Fed's FOMC calendar.
      </p>
    </section>
  )
}

export function NowcastCard({ nowcasts, quarterly }) {
  const cle = nowcasts?.cleveland
  const g = nowcasts?.gdpnow
  const lastGdp = [...(quarterly ?? [])].reverse().find((q) => q.gdp_growth !== null && q.gdp_growth !== undefined)
  const blocks = [...(cle?.monthly ?? []).slice(0, 2), ...(cle?.quarterly ?? []).slice(0, 1)]
  return (
    <section className="card card-pad" aria-label="Nowcasts">
      <div className="label-xs">Nowcasts</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-hairline p-3">
          <div className="text-xs font-medium text-ink">Atlanta Fed GDPNow</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="num text-2xl font-semibold text-ink">{g?.value?.toFixed(1) ?? '—'}</span>
            <span className="text-sm text-faint">% q/q ann.</span>
          </div>
          <div className="num mt-1 text-[11px] text-faint">{g?.quarter ?? ''}</div>
          {lastGdp && (
            <div className="mt-2 text-[11px] text-muted">
              Last official print: <span className="num text-ink">{lastGdp.gdp_growth.toFixed(1)}%</span> ({lastGdp.quarter})
            </div>
          )}
        </div>
        {blocks.length ? blocks.map((b) => (
          <div key={b.period} className="rounded-lg border border-hairline p-3">
            <div className="text-xs font-medium text-ink">Cleveland Fed inflation nowcast</div>
            <div className="num mt-0.5 text-[11px] text-faint">{b.period}</div>
            <dl className="mt-2 space-y-1">
              {Object.entries(b.values).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <dt className="text-muted">{k}</dt>
                  <dd className="num text-ink">{v.toFixed(2)}%</dd>
                </div>
              ))}
            </dl>
          </div>
        )) : (
          <div className="rounded-lg border border-hairline p-3 text-xs text-muted">
            Cleveland Fed nowcast unavailable this run.
          </div>
        )}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-faint">
        Cleveland monthly figures are m/m % changes; quarterly figures are annualised. GDPNow is
        the Atlanta Fed's model estimate of real GDP growth for the quarter, updated after major releases.
      </p>
    </section>
  )
}

export function NotesCard({ notes, className = '' }) {
  const items = notes ?? []
  return (
    <section className={`card card-pad flex min-h-0 flex-col ${className}`} aria-label="Dealer and client commentary">
      <div className="label-xs">Dealer / client commentary</div>
      {items.length ? (
        <ul className="mt-2.5 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1 scroll-thin">
          {items.map((n, i) => (
            <li key={`${n.date}-${i}`} className="rounded-md border border-hairline px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-faint">
                <span className="num">{dayLong(n.date)}</span>
                <span>·</span>
                <span>{n.source}</span>
                {(n.tags ?? []).map((t) => (
                  <span key={t} className="rounded border border-hairline px-1.5 py-px">{t}</span>
                ))}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink">{n.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 flex-1 text-xs leading-relaxed text-muted">
          No notes yet. Dealer and client commentary has no public feed, so add it by
          hand to <code className="text-ink">config/notes.json</code> — it appears here on
          the next refresh.
        </p>
      )}
    </section>
  )
}

export function FedNewsCard({ news, className = '' }) {
  const items = news ?? []
  return (
    <section className={`card card-pad flex min-h-0 flex-col ${className}`} aria-label="Latest from the Fed">
      <div className="label-xs">Latest from the Fed</div>
      {items.length ? (
        <ul className="mt-2.5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 scroll-thin">
          {items.map((n) => (
            <li key={n.url}>
              <a href={n.url} target="_blank" rel="noreferrer" className="block rounded-md border border-hairline px-2.5 py-2 text-xs hover:border-white/20">
                <div className="line-clamp-2 font-medium text-ink">{n.title}</div>
                <div className="num mt-0.5 text-[10px] text-faint">
                  {n.date ? dayLong(n.date) : ''} · {n.kind === 'speeches' ? 'Speech' : 'Monetary policy release'}
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 flex-1 text-xs text-muted">No recent items.</p>
      )}
      <p className="mt-3 border-t border-hairline pt-2.5 text-[10px] leading-relaxed text-faint">
        federalreserve.gov monetary-policy press releases and speeches feeds.
      </p>
    </section>
  )
}
