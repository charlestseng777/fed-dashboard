import { Brush, ComposedChart, ResponsiveContainer } from 'recharts'

/**
 * Date-range brush shared by every chart on a tab (same pattern as the UK
 * dashboard). Works on monthly ('YYYY-MM'), weekly or daily ('YYYY-MM-DD')
 * rows: presets are expressed as a start date, so they mean the same thing
 * whatever the frequency.
 */
function presets(lastDate) {
  const year = lastDate?.slice(0, 4)
  const back = (years) => {
    if (!lastDate) return null
    const d = new Date(`${lastDate.slice(0, 7)}-01T00:00:00Z`)
    d.setUTCFullYear(d.getUTCFullYear() - years)
    return d.toISOString().slice(0, lastDate.length === 7 ? 7 : 10)
  }
  return [
    { id: 'cycle', label: 'Since 2021', from: '2021-01' },
    { id: '5y', label: '5Y', from: back(5) },
    { id: '3y', label: '3Y', from: back(3) },
    { id: '1y', label: '1Y', from: back(1) },
    { id: 'ytd', label: 'YTD', from: year ? `${year}-01` : null },
    { id: 'all', label: 'All', from: '' },
  ]
}

export function startIndexFor(rows, from) {
  if (!from) return 0
  const i = rows.findIndex((row) => row.date >= from)
  return i < 0 ? 0 : i
}

export default function RangeSlider({ rows, range, onChange, format, unit = 'observations' }) {
  const last = rows.length - 1
  const list = presets(rows[last]?.date)

  const isActive = (p) => range[1] === last && range[0] === startIndexFor(rows, p.from)

  return (
    <div className="border-b border-hairline px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label-xs">Date range</div>
          <div className="num mt-1 text-sm text-ink">
            {format(rows[range[0]]?.date)}
            <span className="mx-2 text-faint">→</span>
            {format(rows[range[1]]?.date)}
            <span className="ml-2 text-xs text-faint">({range[1] - range[0] + 1} {unit})</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range presets">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange([startIndexFor(rows, p.from), last])}
              aria-pressed={isActive(p)}
              className={`chip ${isActive(p) ? 'chip-on' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 h-[26px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 0, right: 4, bottom: 0, left: 4 }}>
            <Brush
              dataKey="date"
              height={18}
              travellerWidth={8}
              startIndex={range[0]}
              endIndex={range[1]}
              stroke="#2E3545"
              fill="rgba(15,17,22,0.55)"
              tickFormatter={format}
              onChange={(next) => {
                if (typeof next?.startIndex === 'number' && typeof next?.endIndex === 'number'
                  && next.endIndex > next.startIndex) {
                  onChange([next.startIndex, next.endIndex])
                }
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Drag the handles to zoom. Every chart on this tab shares this window and a
        synchronised crosshair.
      </p>
    </div>
  )
}
