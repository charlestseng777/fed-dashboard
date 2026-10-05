import { useMemo, useState } from 'react'
import {
  Bar, CartesianGrid, Cell, ComposedChart, Label, LabelList, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { CHROME } from '../lib/series.js'

const EVENT_TONE = {
  policy: '#d95926',
  shock: '#e66767',
  fiscal: '#c98500',
  milestone: '#3987e5',
}

/**
 * One card = one chart. Every time-series panel on the dashboard is this
 * component with a different series list, so they all share the toggle
 * chips, crosshair, tooltip and styling of the UK dashboard's main chart.
 *
 * series: [{ id, label, short, color, width, locked, on, step, dashed,
 *            type: 'line' | 'bar', axis: 'left' | 'right' }]
 */
export default function SeriesChart({
  title, subtitle, data, series, syncId, xFormat, tooltipDate, leftFormat, rightFormat,
  valueFormat, refLines = [], events = [], decisions = [], onSelect, selected,
  height = 'h-[300px] sm:h-[340px]', header, children, footer, ariaLabel, showLatest = false,
  fullData,
}) {
  const [enabled, setEnabled] = useState(() => series.filter((s) => s.locked || s.on).map((s) => s.id))
  const [hoveredEvent, setHoveredEvent] = useState(null)
  // Per-chart horizon. 'tab' follows the tab's shared date slider (`data`);
  // the others zoom this chart alone over its full history (`fullData`).
  const [horizon, setHorizon] = useState('tab')
  const shown = useMemo(() => {
    if (!fullData || horizon === 'tab') return data
    const from = horizonStart(fullData, horizon)
    const i = fullData.findIndex((row) => row.date >= from)
    return i < 0 ? fullData : fullData.slice(i)
  }, [data, fullData, horizon])

  const visible = useMemo(() => series.filter((s) => s.locked || enabled.includes(s.id)), [series, enabled])
  const hasRight = visible.some((s) => s.axis === 'right')
  const toggleable = series.some((s) => !s.locked)

  const from = shown[0]?.date
  const to = shown[shown.length - 1]?.date
  const pointEvents = events.filter((e) => e.date >= from && e.date <= to)
  const shownDecisions = decisions.filter((d) => d.date >= from && d.date <= to)

  const fmt = valueFormat ?? ((v) => v.toFixed(2))

  // Latest value of each visible line, for the bold readout and the
  // end-of-line labels (showLatest), so today's level needs no hovering.
  const latest = useMemo(() => {
    if (!showLatest) return []
    return visible.map((s) => {
      for (let i = shown.length - 1; i >= 0; i -= 1) {
        const v = shown[i][s.id]
        if (v !== null && v !== undefined) {
          // Change over ~5 observations (a trading week on daily data).
          const prev = shown.slice(0, Math.max(0, i - 4)).reverse().find((r) => r[s.id] !== null && r[s.id] !== undefined)
          return { series: s, index: i, date: shown[i].date, value: v, change: prev ? v - prev[s.id] : null }
        }
      }
      return null
    }).filter(Boolean)
  }, [showLatest, visible, shown])

  return (
    <section className="card" aria-label={ariaLabel ?? title}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 max-w-2xl text-xs text-muted">{subtitle}</p>}
        </div>
        {(toggleable || series.length > 1) && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Series shown">
            {series.map((s) => {
              const on = s.locked || enabled.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={s.locked}
                  aria-pressed={on}
                  onClick={() => !s.locked && setEnabled((cur) => (cur.includes(s.id)
                    ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                  title={s.locked ? `${s.label} is always shown` : `Toggle ${s.label}`}
                  className={`chip ${on ? 'chip-on' : ''} ${s.locked ? 'cursor-default opacity-95' : ''}`}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: on ? s.color : '#3A4150' }} aria-hidden="true" />
                  {s.short}
                  {s.axis === 'right' && <span className="text-[9px] text-faint">R</span>}
                </button>
              )
            })}
          </div>
        )}
      </header>

      {header}

      {fullData && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-4 py-2 sm:px-5" role="group" aria-label="Chart horizon">
          <span className="label-xs mr-1">Horizon</span>
          {HORIZONS.map((h) => (
            <button
              key={h.id}
              type="button"
              aria-pressed={horizon === h.id}
              onClick={() => setHorizon(h.id)}
              title={h.id === 'tab' ? "Follow the tab's date range slider" : `Show the last ${h.label} on this chart only`}
              className={`chip px-2 py-0.5 text-[11px] ${horizon === h.id ? 'chip-on' : ''}`}
            >
              {h.label}
            </button>
          ))}
        </div>
      )}

      {showLatest && latest.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 border-b border-hairline px-4 py-3 sm:px-5" aria-live="polite">
          <span className="label-xs">Latest · {(tooltipDate ?? xFormat)(latest.reduce((a, l) => (l.date > a ? l.date : a), latest[0].date))}</span>
          {latest.map((l) => (
            <span key={l.series.id} className="flex items-baseline gap-2">
              <span className="h-2 w-2 shrink-0 self-center rounded-sm" style={{ backgroundColor: l.series.color }} aria-hidden="true" />
              <span className="text-xs text-muted">{l.series.short}</span>
              <span className="num text-lg font-bold text-ink">{(l.series.format ?? fmt)(l.value)}</span>
              {l.date !== latest.reduce((a, x) => (x.date > a ? x.date : a), latest[0].date) && (
                <span className="num text-[10px] text-faint">({(tooltipDate ?? xFormat)(l.date)})</span>
              )}
              {l.change !== null && (
                <span className={`num text-[11px] ${l.change > 0 ? 'text-[#E9B872]' : l.change < 0 ? 'text-[#7FB9E8]' : 'text-faint'}`}>
                  {(l.series.format ?? fmt)(l.change)} on the week
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className={`${height} px-1 py-4 sm:px-2`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={shown}
            syncId={syncId}
            margin={{ top: 12, right: showLatest ? 80 : hasRight ? 4 : 20, bottom: 4, left: 4 }}
            onClick={(state) => state?.activeLabel && onSelect?.(state.activeLabel)}
          >
            <CartesianGrid stroke={CHROME.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={xFormat}
              tickLine={false}
              axisLine={{ stroke: CHROME.axis }}
              minTickGap={32}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="left"
              tickFormatter={leftFormat}
              tickLine={false}
              axisLine={false}
              width={48}
              domain={['auto', 'auto']}
            />
            {hasRight && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={rightFormat ?? leftFormat}
                tickLine={false}
                axisLine={false}
                width={48}
                domain={['auto', 'auto']}
              />
            )}

            {refLines.map((line) => (
              <ReferenceLine
                key={`${line.y}-${line.label}`}
                yAxisId={line.axis ?? 'left'}
                y={line.y}
                stroke={line.color ?? '#4A5468'}
                strokeDasharray={line.solid ? undefined : '4 4'}
              >
                {line.label && <Label value={line.label} position="insideBottomLeft" fill="#6C7689" fontSize={10} />}
              </ReferenceLine>
            ))}

            {selected && (
              <ReferenceLine yAxisId="left" x={selected} stroke="#E8ECF4" strokeOpacity={0.35} ifOverflow="hidden" />
            )}

            {shownDecisions.map((d) => (
              <ReferenceLine
                key={`dec-${d.date}`}
                yAxisId="left"
                x={nearestX(shown, d.date)}
                stroke={d.change_bp > 0 ? '#E9B872' : '#7FB9E8'}
                strokeOpacity={0.3}
                strokeDasharray="2 3"
                ifOverflow="hidden"
              />
            ))}

            {pointEvents.map((event) => (
              <ReferenceLine
                key={event.id}
                yAxisId="left"
                x={nearestX(shown, event.date)}
                stroke={EVENT_TONE[event.category] ?? '#8A93A6'}
                strokeOpacity={hoveredEvent?.id === event.id ? 0.85 : 0.28}
                strokeDasharray="3 3"
                ifOverflow="hidden"
                label={({ viewBox }) => (
                  <g
                    transform={`translate(${viewBox.x}, ${viewBox.y - 2})`}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredEvent(event)}
                    onMouseLeave={() => setHoveredEvent(null)}
                  >
                    <rect x={-11} y={-11} width={22} height={22} fill="transparent" />
                    <circle
                      r={hoveredEvent?.id === event.id ? 5.5 : 4}
                      fill={hoveredEvent?.id === event.id ? (EVENT_TONE[event.category] ?? '#8A93A6') : CHROME.surface}
                      stroke={EVENT_TONE[event.category] ?? '#8A93A6'}
                      strokeWidth={2}
                    />
                  </g>
                )}
              />
            ))}

            <Tooltip
              cursor={{ stroke: '#4A5468', strokeWidth: 1, strokeDasharray: '3 3' }}
              isAnimationActive={false}
              // Keep the popup just below the cursor all the way down, so it
              // tracks the mouse vertically instead of flipping up over the
              // lines when the cursor reaches the lower half of the plot.
              allowEscapeViewBox={{ x: false, y: true }}
              wrapperStyle={{ zIndex: 20 }}
              content={<SeriesTooltip series={visible} fmt={fmt} dateFormat={tooltipDate ?? xFormat} />}
            />

            {visible.map((s) => (s.type === 'bar' ? (
              <Bar key={s.id} yAxisId={s.axis ?? 'left'} dataKey={s.id} name={s.label} isAnimationActive={false} maxBarSize={10}>
                {shown.map((row) => (
                  <Cell key={row.date} fill={s.color} fillOpacity={(row[s.id] ?? 0) < 0 ? 0.45 : 0.75} />
                ))}
              </Bar>
            ) : (
              <Line
                key={s.id}
                yAxisId={s.axis ?? 'left'}
                type={s.step ? 'stepAfter' : 'monotone'}
                dataKey={s.id}
                name={s.label}
                stroke={s.color}
                strokeWidth={s.width ?? 1.75}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: CHROME.surface }}
                connectNulls
                isAnimationActive={false}
              >
                {showLatest && (
                  <LabelList
                    dataKey={s.id}
                    content={endLabel(s, latest.find((l) => l.series.id === s.id)?.index, s.format ?? fmt)}
                  />
                )}
              </Line>
            )))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {children}

      {(events.length > 0 || footer) && (
        <footer className="border-t border-hairline px-4 py-3 sm:px-5">
          {hoveredEvent ? (
            <div className="animate-fade-up">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_TONE[hoveredEvent.category] ?? '#8A93A6' }} aria-hidden="true" />
                <span className="text-xs font-semibold text-ink">{hoveredEvent.label}</span>
                <span className="num text-[11px] text-faint">{hoveredEvent.date}</span>
              </div>
              <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-muted">{hoveredEvent.description}</p>
            </div>
          ) : (
            footer ?? (
              <p className="text-xs text-faint">
                Hover a marker for the event behind it
                {pointEvents.length > 0 && ` — ${pointEvents.length} in this window`}. Dotted
                verticals mark Fed rate changes (amber = hike, blue = cut).
              </p>
            )
          )}
        </footer>
      )}
    </section>
  )
}

const HORIZONS = [
  { id: 'tab', label: 'Tab range' },
  { id: '5y', label: '5Y', years: 5 },
  { id: '3y', label: '3Y', years: 3 },
  { id: '1y', label: '1Y', years: 1 },
  { id: 'ytd', label: 'YTD' },
]

/** First date of a horizon, relative to the latest row ('YYYY-MM' or 'YYYY-MM-DD'). */
function horizonStart(rows, id) {
  const last = rows[rows.length - 1]?.date
  if (!last) return ''
  if (id === 'ytd') return `${last.slice(0, 4)}-01`
  const years = HORIZONS.find((h) => h.id === id)?.years ?? 0
  return `${parseInt(last.slice(0, 4), 10) - years}${last.slice(4)}`
}

/** Bold value label drawn only at a line's last point. */
function endLabel(series, lastIndex, format) {
  return function EndLabel({ x, y, index, value }) {
    if (index !== lastIndex || x === undefined || y === undefined || value === null || value === undefined) return null
    return (
      <text x={x + 8} y={y} dy={4} fill={series.color} fontSize={12} fontWeight={700} style={{ pointerEvents: 'none' }}>
        {format(value)}
      </text>
    )
  }
}

/**
 * The x axis is categorical, so a marker must land on an actual row's date.
 * Monthly rows ('YYYY-MM') take a day-dated marker's month; daily/weekly rows
 * snap a month- or day-dated marker to the first row on or after it.
 */
function nearestX(data, key) {
  if (!data.length) return key
  const width = data[0].date.length
  if (width === 7) return key.slice(0, 7)
  return data.find((row) => row.date >= key)?.date ?? key
}

function SeriesTooltip({ active, payload, label, series, fmt, dateFormat }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="pointer-events-none w-[260px] rounded-lg border border-hairline bg-[#10131A]/95 p-3 shadow-2xl backdrop-blur">
      <div className="num text-xs font-semibold text-ink">{dateFormat ? dateFormat(label) : label}</div>
      <div className="mt-2.5 space-y-1.5">
        {series.map((s) => {
          const v = row[s.id]
          if (v === null || v === undefined) return null
          return (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="flex-1 truncate text-muted">{s.label}</span>
              <span className="num text-right font-medium text-ink">{(s.format ?? fmt)(v)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
