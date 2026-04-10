import { useMemo, useState } from 'react'

const RANGES = ['1H', '1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL', 'CUSTOM']

export function cutoffDate(range) {
  const now = new Date()
  if (range === '1H')  return now.toISOString().slice(0, 10)   // zoom to today on the curve
  if (range === '1D')  { const d = new Date(now); d.setDate(d.getDate() - 1);         return d.toISOString().slice(0, 10) }
  if (range === '1W')  { const d = new Date(now); d.setDate(d.getDate() - 7);         return d.toISOString().slice(0, 10) }
  if (range === '1M')  { const d = new Date(now); d.setMonth(d.getMonth() - 1);       return d.toISOString().slice(0, 10) }
  if (range === '3M')  { const d = new Date(now); d.setMonth(d.getMonth() - 3);       return d.toISOString().slice(0, 10) }
  if (range === '6M')  { const d = new Date(now); d.setMonth(d.getMonth() - 6);       return d.toISOString().slice(0, 10) }
  if (range === 'YTD') return `${now.getFullYear()}-01-01`
  if (range === '1Y')  { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10) }
  return null
}

function fmtDollar(v) {
  const abs = Math.abs(v)
  const str = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${Math.round(abs)}`
  return v < 0 ? `-${str}` : str
}

function fmtSigned(v) {
  const s = fmtDollar(v)
  return v > 0 ? `+${s}` : s
}

const DEFAULT_FILTER = { range: 'ALL', start: '', end: '' }

// filter = { range: '1D'|...|'ALL'|'CUSTOM', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
// onFilterChange = (filter) => void
export default function EquityCurve({ data = [], filter: filterProp, onFilterChange }) {
  const [filterInternal, setFilterInternal] = useState(DEFAULT_FILTER)
  const filter    = filterProp    ?? filterInternal
  const setFilter = onFilterChange ?? setFilterInternal

  const [hover, setHover] = useState(null)

  const isCustom = filter.range === 'CUSTOM'

  // ── Build calendar-filled points ──────────────────────────────────────────
  const allPoints = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
    if (!sorted.length) return []

    let cum = 0
    const byDate = {}
    sorted.forEach(d => { cum += d.total_pnl; byDate[d.date] = cum })

    const first = new Date(sorted[0].date + 'T00:00:00')
    const last  = new Date(sorted[sorted.length - 1].date + 'T00:00:00')
    const pts   = []
    let carry   = 0
    const cur   = new Date(first)
    while (cur <= last) {
      const ds = cur.toISOString().slice(0, 10)
      if (byDate[ds] !== undefined) carry = byDate[ds]
      pts.push({ date: ds, value: carry })
      cur.setDate(cur.getDate() + 1)
    }
    return pts
  }, [data])

  // ── Filter points by range or custom dates ────────────────────────────────
  const points = useMemo(() => {
    if (!allPoints.length) return allPoints

    if (isCustom) {
      let slice = allPoints
      if (filter.start) slice = slice.filter(p => p.date >= filter.start)
      if (filter.end)   slice = slice.filter(p => p.date <= filter.end)
      return slice
    }

    const cut = cutoffDate(filter.range)
    if (!cut) return allPoints
    const idx = allPoints.findIndex(p => p.date >= cut)
    if (idx === -1) return []                               // cut is newer than all data
    return idx > 0 ? allPoints.slice(idx - 1) : allPoints  // idx=0 means cut predates all data → show all
  }, [allPoints, filter, isCustom])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleRange = r => {
    setFilter({ ...filter, range: r })
    setHover(null)
  }
  const handleDate = (field, value) => {
    setFilter({ ...filter, range: 'CUSTOM', [field]: value })
    setHover(null)
  }

  // ── Dimensions ────────────────────────────────────────────────────────────
  const W       = 1000
  const EQ_H    = 200
  const PAD     = { t: 16, r: 20, b: 28, l: 64 }
  const TOTAL_H = PAD.t + EQ_H + PAD.b
  const chartW  = W - PAD.l - PAD.r

  const hasData = points.length >= 2

  if (!hasData) {
    return (
      <div className="border border-border bg-card h-full flex flex-col">
        <Header
          filter={filter} onRange={handleRange} onDate={handleDate}
          rangeChg={null} isCustom={isCustom}
        />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Not enough data</p>
        </div>
      </div>
    )
  }

  // ── Scales ────────────────────────────────────────────────────────────────
  const vals   = points.map(p => p.value)
  const minV   = Math.min(0, ...vals)
  const maxV   = Math.max(0, ...vals)
  const rangeV = (maxV - minV) || 1

  const toX   = i => PAD.l + (i / (points.length - 1)) * chartW
  const toY   = v => PAD.t + (1 - (v - minV) / rangeV) * EQ_H
  const zeroY = toY(0)

  // ── Paths ─────────────────────────────────────────────────────────────────
  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`
  ).join('')

  const areaPath =
    `M${toX(0).toFixed(1)},${zeroY.toFixed(1)}` +
    points.map((p, i) => ` L${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join('') +
    ` L${toX(points.length - 1).toFixed(1)},${zeroY.toFixed(1)} Z`

  const lastVal  = points[points.length - 1].value
  const rangeChg = lastVal - points[0].value
  const isPos    = lastVal >= 0
  const dotColor = isPos ? '#34d399' : '#f43f5e'

  // ── Axis labels ───────────────────────────────────────────────────────────
  const yTicks  = [0, 0.25, 0.5, 0.75, 1].map(t => ({ v: minV + t * rangeV, y: toY(minV + t * rangeV) }))
  const numX    = Math.min(6, points.length)
  const xLabels = Array.from({ length: numX }, (_, i) => {
    const idx = Math.round(i * (points.length - 1) / Math.max(numX - 1, 1))
    return { label: points[idx].date.slice(5), x: toX(idx) }
  })

  // ── Hover ─────────────────────────────────────────────────────────────────
  const handleMouseMove = e => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx   = ((e.clientX - rect.left) / rect.width) * W
    if (mx < PAD.l || mx > W - PAD.r) { setHover(null); return }
    const idx  = Math.max(0, Math.min(points.length - 1, Math.round((mx - PAD.l) / chartW * (points.length - 1))))
    const pt   = points[idx]
    setHover({ x: toX(idx), y: toY(pt.value), value: pt.value, date: pt.date })
  }

  const TW = 150, TH = 50
  const tx = hover ? Math.min(W - PAD.r - TW - 4, Math.max(PAD.l + 4, hover.x - TW / 2)) : 0
  const ty = hover ? (hover.y > PAD.t + TH + 14 ? hover.y - TH - 10 : hover.y + 14) : 0

  return (
    <div className="border border-border bg-card h-full flex flex-col">
      <Header
        filter={filter} onRange={handleRange} onDate={handleDate}
        rangeChg={rangeChg} isCustom={isCustom}
        rangeChgStr={fmtSigned(rangeChg)}
      />

      <svg
        viewBox={`0 0 ${W} ${TOTAL_H}`}
        className="w-full flex-1 cursor-crosshair"
        style={{ minHeight: 0 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="ec-above">
            <rect x={PAD.l} y={PAD.t} width={chartW} height={Math.max(0, zeroY - PAD.t)} />
          </clipPath>
          <clipPath id="ec-below">
            <rect x={PAD.l} y={zeroY} width={chartW} height={Math.max(0, PAD.t + EQ_H - zeroY)} />
          </clipPath>
          <linearGradient id="ec-grad-pos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#34d399" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="ec-grad-neg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f43f5e" stopOpacity="0.01" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.18" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map(({ y }, i) => (
          <line key={i} x1={PAD.l} y1={y} x2={W - PAD.r} y2={y}
            stroke="currentColor" strokeOpacity="0.055" />
        ))}

        {/* Y labels */}
        {yTicks.map(({ v, y }, i) => (
          <text key={i} x={PAD.l - 8} y={y} textAnchor="end" dominantBaseline="middle"
            fill="currentColor" fillOpacity="0.32" fontSize="10"
            fontFamily='"IBM Plex Mono", ui-monospace, monospace'>
            {fmtDollar(v)}
          </text>
        ))}

        {/* Zero baseline */}
        <line x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY}
          stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />

        {/* Area fill */}
        <path d={areaPath} fill="url(#ec-grad-pos)" clipPath="url(#ec-above)" />
        <path d={areaPath} fill="url(#ec-grad-neg)" clipPath="url(#ec-below)" />

        {/* Line — split color at zero */}
        <path d={linePath} fill="none" stroke="#34d399" strokeWidth="1.5"
          strokeLinejoin="round" clipPath="url(#ec-above)" />
        <path d={linePath} fill="none" stroke="#f43f5e" strokeWidth="1.5"
          strokeLinejoin="round" clipPath="url(#ec-below)" />

        {/* Pulsing live dot */}
        {!hover && (
          <g>
            <circle cx={toX(points.length - 1)} cy={toY(lastVal)} r="3" fill={dotColor} />
            <circle cx={toX(points.length - 1)} cy={toY(lastVal)} r="3" fill="none"
              stroke={dotColor} strokeWidth="1.2" strokeOpacity="0.5">
              <animate attributeName="r" values="3;8;3" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
            </circle>
          </g>
        )}

        {/* Hover */}
        {hover && (
          <>
            <line x1={hover.x} y1={PAD.t} x2={hover.x} y2={PAD.t + EQ_H}
              stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 4" />
            <circle cx={hover.x} cy={hover.y} r="3.5"
              fill={hover.value >= 0 ? '#34d399' : '#f43f5e'} />
            <rect x={tx} y={ty} width={TW} height={TH} rx="1"
              fill="hsl(229,44%,8%)" stroke="hsl(227,38%,18%)" strokeWidth="1" />
            <text x={tx + 10} y={ty + 16}
              fill="currentColor" fillOpacity="0.42" fontSize="9"
              fontFamily='"IBM Plex Mono", ui-monospace, monospace'>
              {hover.date}
            </text>
            <text x={tx + 10} y={ty + 36}
              fill={hover.value >= 0 ? '#34d399' : '#f43f5e'}
              fontSize="14" fontWeight="700"
              fontFamily='"IBM Plex Mono", ui-monospace, monospace'>
              {fmtSigned(hover.value)}
            </text>
          </>
        )}

        {/* X labels */}
        {xLabels.map(({ label, x }, i) => (
          <text key={i} x={x} y={TOTAL_H - 6} textAnchor="middle"
            fill="currentColor" fillOpacity="0.3" fontSize="10"
            fontFamily='"IBM Plex Mono", ui-monospace, monospace'>
            {label}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({ filter, onRange, onDate, rangeChg, rangeChgStr, isCustom }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 shrink-0 border-b border-border gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">Equity Curve</span>
        {rangeChgStr && (
          <span className={`font-mono text-xs font-semibold tabular-nums ${rangeChg >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
            {rangeChgStr}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Custom date inputs — shown when CUSTOM is active */}
        {isCustom && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={filter.start}
              onChange={e => onDate('start', e.target.value)}
              className="text-[11px] font-mono border border-border bg-muted/30 px-2 py-1 text-foreground focus:outline-none focus:border-primary transition-colors"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <input
              type="date"
              value={filter.end}
              onChange={e => onDate('end', e.target.value)}
              className="text-[11px] font-mono border border-border bg-muted/30 px-2 py-1 text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        )}

        {/* Range buttons */}
        <div className="flex border border-border">
          {RANGES.map((r, i) => (
            <button
              key={r}
              onClick={() => onRange(r)}
              className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                i > 0 ? 'border-l border-border' : ''
              } ${
                filter.range === r
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {r === 'CUSTOM' ? 'Custom' : r}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
