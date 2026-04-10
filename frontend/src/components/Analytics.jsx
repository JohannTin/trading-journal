import { useMemo, useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTrades, getStrategies } from '../api'
import { useAccount } from '../AccountContext'
import { CARD, SECTION_LABEL, pnlColor, fmtShort } from '../styles'
import EquityCurve, { cutoffDate } from './EquityCurve'
import TradeChart from './TradeChart'
import { ChevronDown } from 'lucide-react'

// ── Formatters ────────────────────────────────────────────────────────────────

function dollar(n) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  const str = abs >= 10000 ? `$${(abs / 1000).toFixed(1)}K` : `$${abs.toFixed(2)}`
  return n >= 0 ? `+${str}` : `-${str}`
}

function pct(n) {
  if (n == null || isNaN(n)) return '—'
  return `${n.toFixed(1)}%`
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }) {
  return (
    <div className={`${CARD} px-4 py-3 flex flex-col gap-0.5`}>
      <span className={`${SECTION_LABEL} mb-1`}>{label}</span>
      <span className={`text-lg font-bold font-mono leading-none ${color ?? 'text-foreground'}`}>{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground mt-0.5">{sub}</span>}
    </div>
  )
}

function parseMins(t) {
  if (!t) return null
  const s = t.includes(':') ? t : `${t.slice(0, 2)}:${t.slice(2, 4)}`
  const [h, m] = s.split(':').map(Number)
  return isNaN(h) || isNaN(m) ? null : h * 60 + m
}

function fmtMins(m) {
  if (m == null) return '—'
  if (m < 60) return `${Math.round(m)}m`
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`
}

// ── Vertical bar chart (DOW / Monthly) ───────────────────────────────────────

function VBars({ data, height = 130 }) {
  if (!data.length) return null
  const n = data.length
  const VB_W = 400
  const VB_H = height          // internal coords match rendered height 1-for-1
  const PAD_B = 22, PAD_T = 8, PAD_X = 10
  const MIN_BAR = VB_H * 0.05  // minimum visual bar height so small values aren't invisible

  const availW = VB_W - PAD_X * 2
  const STEP = availW / n
  const BAR_W = Math.min(STEP * 0.65, 36)

  const vals = data.map(d => d.value)
  const min = Math.min(0, ...vals)
  const max = Math.max(0, ...vals)
  const range = (max - min) || 1
  const chartH = VB_H - PAD_B - PAD_T
  const zY = PAD_T + chartH * (max / range)

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height, display: 'block' }}
    >
      {data.map((d, i) => {
        const rawH = (Math.abs(d.value) / range) * chartH
        const barH = d.value !== 0 ? Math.max(MIN_BAR, rawH) : 0
        const cx = PAD_X + (i + 0.5) * STEP
        const x = cx - BAR_W / 2
        const y = d.value >= 0 ? zY - barH : zY
        const color = d.value >= 0 ? '#10b981' : '#f43f5e'
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={BAR_W} height={barH} fill={color} opacity={0.8} rx={2} />
            <text
              x={cx} y={VB_H - 4}
              textAnchor="middle"
              fontSize={10} fill="currentColor" fillOpacity={0.5}
              fontFamily="IBM Plex Mono, monospace"
            >
              {d.label}
            </text>
          </g>
        )
      })}
      <line x1={PAD_X} y1={zY} x2={VB_W - PAD_X} y2={zY} stroke="currentColor" strokeOpacity={0.15} />
    </svg>
  )
}

// ── Strategy dropdown (matches AccountDropdown style) ─────────────────────────

function StrategyDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const label = value || 'All Strategies'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 border border-border bg-card text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        {label}
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 border border-border bg-card shadow-xl min-w-[160px]">
          {[{ value: '', label: 'All Strategies' }, ...options.map(s => ({ value: s, label: s }))].map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-4 py-2 text-xs font-semibold transition-colors ${
                value === opt.value
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Analytics Component ──────────────────────────────────────────────────

export default function Analytics() {
  const [strategy, setStrategy]     = useState('')
  const [filter, setFilter]         = useState({ range: 'ALL', start: '', end: '' })
  const [chartTrade, setChartTrade] = useState(null)
  const [tab, setTab]               = useState('overview') // 'overview' | 'by-strategy'
  const [showMC, setShowMC]         = useState(false)
  const { accountId } = useAccount()

  const { data: allTrades = [] } = useQuery({
    queryKey: ['trades', accountId],
    queryFn: () => getTrades(null, accountId),
  })
  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies', accountId],
    queryFn: () => getStrategies(accountId),
  })

  const trades = useMemo(
    () => (strategy ? allTrades.filter(t => t.strategy === strategy) : allTrades),
    [allTrades, strategy]
  )

  // All closed (strategy-filtered only) — fed to the equity chart
  const allClosed = useMemo(() =>
    trades.filter(t => t.status === 'closed'),
  [trades])

  // Range-filtered closed — drives all stats cards
  // '1H' is a curve-zoom only (daily data has no sub-day granularity) — fall back to 1D for stats
  const closed = useMemo(() => {
    if (filter.range === 'CUSTOM') {
      return allClosed.filter(t =>
        (!filter.start || t.date >= filter.start) &&
        (!filter.end   || t.date <= filter.end)
      )
    }
    const statsRange = filter.range === '1H' ? '1D' : filter.range
    const cut = cutoffDate(statsRange)
    return cut ? allClosed.filter(t => t.date >= cut) : allClosed
  }, [allClosed, filter])

  // ── Core stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!closed.length) return null

    const wins = closed.filter(t => t.total_pnl > 0)
    const losses = closed.filter(t => t.total_pnl < 0)
    const totalPnl = closed.reduce((s, t) => s + t.total_pnl, 0)
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.total_pnl, 0) / wins.length : 0
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.total_pnl, 0) / losses.length : 0
    const grossWin = wins.reduce((s, t) => s + t.total_pnl, 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.total_pnl, 0))
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? Infinity : 0
    const winRate = (wins.length / closed.length) * 100

    // Expectancy = (winRate * avgWin) + (lossRate * avgLoss)
    const lossRate = 1 - winRate / 100
    const expectancy = (winRate / 100) * avgWin + lossRate * avgLoss

    // Streak analysis
    const sorted = [...closed].sort((a, b) =>
      a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
    )
    let maxWinStreak = 0, maxLossStreak = 0, tmpW = 0, tmpL = 0
    for (const t of sorted) {
      if (t.total_pnl > 0) { tmpW++; tmpL = 0 } else { tmpL++; tmpW = 0 }
      maxWinStreak = Math.max(maxWinStreak, tmpW)
      maxLossStreak = Math.max(maxLossStreak, tmpL)
    }
    let curStreak = 0, curType = null
    for (let i = sorted.length - 1; i >= 0; i--) {
      const w = sorted[i].total_pnl > 0
      if (curType === null) curType = w
      if (w === curType) curStreak++
      else break
    }

    // Max drawdown from equity curve
    let peak = 0, equity = 0, maxDrawdown = 0, currentDrawdown = 0
    for (const t of sorted) {
      equity += t.total_pnl
      if (equity > peak) peak = equity
      const dd = peak - equity
      if (dd > maxDrawdown) maxDrawdown = dd
    }
    currentDrawdown = peak > equity ? peak - equity : 0

    const sortedByPnl = [...closed].sort((a, b) => b.total_pnl - a.total_pnl)

    return {
      totalPnl, winRate, avgWin, avgLoss, profitFactor, expectancy,
      maxDrawdown, currentDrawdown,
      wins: wins.length, losses: losses.length, total: closed.length,
      maxWinStreak, maxLossStreak, curStreak, curType,
      bestTrade: sortedByPnl[0] ?? null,
      worstTrade: sortedByPnl[sortedByPnl.length - 1] ?? null,
      topTrades: { best: sortedByPnl.slice(0, 5), worst: sortedByPnl.slice(-5).reverse() },
    }
  }, [closed])

  // ── Equity + Drawdown points ──────────────────────────────────────────────
  // Daily aggregated P&L — same shape as calendar data for EquityCurve
  // Equity data from ALL closed (unfiltered) — chart handles its own windowing
  const equityData = useMemo(() => {
    const map = {}
    for (const t of allClosed) {
      map[t.date] = (map[t.date] ?? 0) + t.total_pnl
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total_pnl]) => ({ date, total_pnl }))
  }, [allClosed])

  // ── P&L by day of week ────────────────────────────────────────────────────
  const dowData = useMemo(() => {
    const map = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const t of closed) {
      const d = new Date(t.date + 'T12:00:00').getDay()
      if (d >= 1 && d <= 5) map[d] += t.total_pnl
    }
    return [
      { label: 'Mon', value: map[1] },
      { label: 'Tue', value: map[2] },
      { label: 'Wed', value: map[3] },
      { label: 'Thu', value: map[4] },
      { label: 'Fri', value: map[5] },
    ]
  }, [closed])

  // ── P&L by month ──────────────────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const map = {}
    for (const t of closed) {
      const key = t.date.slice(0, 7)
      map[key] = (map[key] ?? 0) + t.total_pnl
    }
    const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([key, value]) => {
        const [yr, mo] = key.split('-')
        return { label: `${MONTH_ABBR[+mo - 1]}'${yr.slice(2)}`, value }
      })
  }, [closed])

  // ── P&L by ticker ─────────────────────────────────────────────────────────
  const tickerData = useMemo(() => {
    const map = {}
    for (const t of closed) {
      if (!map[t.ticker]) map[t.ticker] = { pnl: 0, count: 0, wins: 0 }
      map[t.ticker].pnl += t.total_pnl
      map[t.ticker].count++
      if (t.total_pnl > 0) map[t.ticker].wins++
    }
    return Object.entries(map)
      .map(([ticker, { pnl, count, wins }]) => ({ ticker, pnl, count, winRate: (wins / count) * 100 }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 10)
  }, [closed])

  // ── Calls vs Puts ─────────────────────────────────────────────────────────
  const optionData = useMemo(() => {
    const group = type => {
      const arr = closed.filter(t => t.option_type === type)
      const wins = arr.filter(t => t.total_pnl > 0)
      return {
        count: arr.length,
        pnl: arr.reduce((s, t) => s + t.total_pnl, 0),
        wins: wins.length,
        winRate: arr.length ? (wins.length / arr.length) * 100 : 0,
      }
    }
    return { calls: group('Call'), puts: group('Put') }
  }, [closed])

  // ── Strategy breakdown ────────────────────────────────────────────────────
  const stratData = useMemo(() => {
    const map = {}
    for (const t of closed) {
      const key = t.strategy || 'Untagged'
      if (!map[key]) map[key] = { pnl: 0, count: 0, wins: 0 }
      map[key].pnl += t.total_pnl
      map[key].count++
      if (t.total_pnl > 0) map[key].wins++
    }
    return Object.entries(map)
      .map(([name, { pnl, count, wins }]) => ({ name, pnl, count, winRate: (wins / count) * 100 }))
      .sort((a, b) => b.pnl - a.pnl)
  }, [closed])

  const maxTickerPnl = tickerData.length ? Math.max(...tickerData.map(d => Math.abs(d.pnl)), 1) : 1
  const maxStratPnl  = stratData.length  ? Math.max(...stratData.map(d => Math.abs(d.pnl)), 1)  : 1

  // ── Trade duration ────────────────────────────────────────────────────────
  const durationData = useMemo(() => {
    const BUCKETS = [
      { label: '≤5m',   min: 0,  max: 5   },
      { label: '5-15m', min: 5,  max: 15  },
      { label: '15-30m',min: 15, max: 30  },
      { label: '30-60m',min: 30, max: 60  },
      { label: '60m+',  min: 60, max: Infinity },
    ]
    const withDur = closed
      .filter(t => t.exits?.length)
      .map(t => {
        const entry = parseMins(t.time)
        const exit  = Math.max(...t.exits.map(e => parseMins(e.time)).filter(v => v != null))
        const dur   = entry != null && isFinite(exit) ? exit - entry : null
        return dur != null && dur >= 0 ? { ...t, dur } : null
      })
      .filter(Boolean)

    const wins   = withDur.filter(t => t.total_pnl > 0)
    const losses = withDur.filter(t => t.total_pnl < 0)
    const avgWin   = wins.length   ? wins.reduce((s, t)   => s + t.dur, 0) / wins.length   : null
    const avgLoss  = losses.length ? losses.reduce((s, t) => s + t.dur, 0) / losses.length : null

    const buckets = BUCKETS.map(b => {
      const arr  = withDur.filter(t => t.dur >= b.min && t.dur < b.max)
      const bWin = arr.filter(t => t.total_pnl > 0)
      return {
        label:   b.label,
        count:   arr.length,
        wins:    bWin.length,
        winRate: arr.length ? (bWin.length / arr.length) * 100 : null,
        pnl:     arr.reduce((s, t) => s + t.total_pnl, 0),
      }
    }).filter(b => b.count > 0)

    return { avgWin, avgLoss, buckets }
  }, [closed])

  // ── Time of day (15-min intervals) ───────────────────────────────────────
  const todData = useMemo(() => {
    const slots = []
    for (let startMin = 9 * 60 + 30; startMin < 16 * 60; startMin += 15) {
      const h0 = Math.floor(startMin / 60), m0 = startMin % 60
      const end = startMin + 15
      const h1 = Math.floor(end / 60), m1 = end % 60
      slots.push({
        label:    `${h0}:${m0.toString().padStart(2, '0')}-${h1}:${m1.toString().padStart(2, '0')}`,
        startMin,
        endMin:   startMin + 15,
        pnl: 0, wins: 0, count: 0,
      })
    }
    for (const t of closed) {
      const m = parseMins(t.time)
      if (m == null) continue
      const slot = slots.find(s => m >= s.startMin && m < s.endMin)
      if (!slot) continue
      slot.pnl += t.total_pnl
      slot.count++
      if (t.total_pnl > 0) slot.wins++
    }
    return slots
      .filter(s => s.count > 0)
      .map(({ label, pnl, wins, count }) => ({ label, value: pnl, wins, count, winRate: (wins / count) * 100 }))
  }, [closed])

  const maxTodPnl = todData.length ? Math.max(...todData.map(d => Math.abs(d.value)), 1) : 1

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-header: tabs + controls */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border gap-3">
        {/* Tabs */}
        <div className="flex border border-border">
          {[['overview', 'Overview'], ['by-strategy', 'By Strategy']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${
                tab === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              } ${id !== 'overview' ? 'border-l border-border' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {stats && (
            <button
              onClick={() => setShowMC(true)}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Monte Carlo
            </button>
          )}
          <StrategyDropdown value={strategy} options={strategies} onChange={setStrategy} />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Empty state */}
        {!stats && (
          <div className={`${CARD} p-12 text-center`}>
            <div className="text-muted-foreground text-sm">No closed trades yet.</div>
            <div className="text-muted-foreground/60 text-xs mt-1">Close some trades to see your analytics.</div>
          </div>
        )}

        {/* ── Stats row ──────────────────────────────────────────────────── */}
        {stats && tab === 'overview' && (
          <div className="grid grid-cols-4 xl:grid-cols-8 gap-2">
            <StatCard label="Net P&L"       value={dollar(stats.totalPnl)}   sub={`${stats.total} closed`}                           color={pnlColor(stats.totalPnl)} />
            <StatCard label="Win Rate"      value={pct(stats.winRate)}        sub={`${stats.wins}W · ${stats.losses}L`}               color={stats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-500'} />
            <StatCard label="Profit Factor" value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}               color={stats.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-500'} />
            <StatCard label="Expectancy"    value={dollar(stats.expectancy)}  sub="per trade"                                         color={pnlColor(stats.expectancy)} />
            <StatCard label="Avg Win"       value={dollar(stats.avgWin)}                                                              color="text-emerald-400" />
            <StatCard label="Avg Loss"      value={dollar(stats.avgLoss)}                                                             color="text-rose-500" />
            <StatCard label="Max Drawdown"  value={dollar(-stats.maxDrawdown)} sub={stats.currentDrawdown > 0 ? `Now: ${dollar(-stats.currentDrawdown)}` : 'Recovered'} color="text-rose-500" />
            <StatCard label={stats.curType ? 'Win Streak' : 'Loss Streak'} value={`${stats.curStreak}×`} sub={`Best ${stats.maxWinStreak}W · ${stats.maxLossStreak}L`} color={stats.curType ? 'text-emerald-400' : 'text-rose-500'} />
          </div>
        )}

        {/* ── By Strategy tab ────────────────────────────────────────────── */}
        {tab === 'by-strategy' && (
          <StrategyComparison allTrades={allTrades} strategies={strategies} />
        )}

        {/* ── Overview tab content ───────────────────────────────────────── */}
        {tab === 'overview' && <>

        {/* ── Equity Curve ───────────────────────────────────────────────── */}
        {stats && (
          <div style={{ height: 300 }}>
            <EquityCurve data={equityData} filter={filter} onFilterChange={setFilter} />
          </div>
        )}

        {/* ── DOW · Win/Loss · Calls vs Puts ─────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">

            {/* Day of Week */}
            <div className={`${CARD} p-4`}>
              <div className={`${SECTION_LABEL} mb-3`}>P&L by Day of Week</div>
              <VBars data={dowData} height={200} />
              <div className="grid grid-cols-5 gap-0.5 mt-2">
                {dowData.map(d => (
                  <div key={d.label} className="text-center">
                    <span className={`text-[10px] font-mono font-bold ${pnlColor(d.value)}`}>
                      {fmtShort(d.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Win / Loss breakdown */}
            <div className={`${CARD} p-4`}>
              <div className={`${SECTION_LABEL} mb-3`}>Win / Loss</div>
              <div className="flex items-center justify-center gap-6 py-2">
                <div className="text-center">
                  <div className="text-3xl font-bold font-mono text-emerald-400">{stats.wins}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Wins</div>
                </div>
                <div className="text-muted-foreground/25 text-2xl font-thin select-none">|</div>
                <div className="text-center">
                  <div className="text-3xl font-bold font-mono text-rose-500">{stats.losses}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Losses</div>
                </div>
              </div>
              <div className="h-1.5 bg-rose-500/25 overflow-hidden mt-1 mb-3">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${stats.winRate}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {[
                  { label: 'Avg Win', value: dollar(stats.avgWin), color: 'text-emerald-400' },
                  { label: 'Avg Loss', value: dollar(stats.avgLoss), color: 'text-rose-500' },
                  { label: 'Profit Factor', value: isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞', color: stats.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-500' },
                  { label: 'Win Rate', value: pct(stats.winRate), color: stats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-500' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                    <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Calls vs Puts */}
            <div className={`${CARD} p-4`}>
              <div className={`${SECTION_LABEL} mb-3`}>Calls vs Puts</div>
              {[
                { type: 'Call', label: 'Calls', data: optionData.calls, badgeCls: 'text-sky-400 bg-sky-500/10' },
                { type: 'Put', label: 'Puts', data: optionData.puts, badgeCls: 'text-violet-400 bg-violet-500/10' },
              ].map(({ label, data, badgeCls }) => (
                <div key={label} className="mb-4 last:mb-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 ${badgeCls}`}>{label}</span>
                    <span className={`text-sm font-bold font-mono ${pnlColor(data.pnl)}`}>
                      {dollar(data.pnl)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted/40 mb-1.5">
                    <div
                      className={`h-full ${data.pnl >= 0 ? 'bg-emerald-400' : 'bg-rose-500'}`}
                      style={{ width: `${data.winRate}%` }}
                    />
                  </div>
                  <div className="flex gap-3">
                    <span className="text-[10px] text-muted-foreground">{data.count} trades</span>
                    <span className="text-[10px] text-muted-foreground">{data.wins}W · {data.count - data.wins}L</span>
                    <span className="text-[10px] text-muted-foreground">{pct(data.winRate)} WR</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tickers + Monthly P&L ───────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">

            {/* Top Tickers */}
            <div className={`${CARD} p-4`}>
              <div className={`${SECTION_LABEL} mb-3`}>Performance by Ticker</div>
              {tickerData.length > 0 ? (
                <div className="space-y-1">
                  {tickerData.map(({ ticker, pnl, count, winRate: wr }) => (
                    <div key={ticker} className="flex items-center gap-2 py-0.5">
                      <span className="w-12 text-xs font-bold font-mono text-foreground shrink-0 truncate">{ticker}</span>
                      <div className="flex-1 h-3.5 bg-muted/20 overflow-hidden">
                        <div
                          className={`h-full ${pnl >= 0 ? 'bg-emerald-500/45' : 'bg-rose-500/45'}`}
                          style={{ width: `${(Math.abs(pnl) / maxTickerPnl) * 100}%` }}
                        />
                      </div>
                      <span className={`w-20 text-xs font-mono text-right ${pnlColor(pnl)}`}>
                        {dollar(pnl)}
                      </span>
                      <span className="w-20 text-[10px] text-muted-foreground text-right shrink-0">
                        {count}t · {pct(wr)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No data</div>
              )}
            </div>

            {/* Monthly P&L */}
            <div className={`${CARD} p-4`}>
              <div className={`${SECTION_LABEL} mb-3`}>Monthly P&L</div>
              {monthlyData.length > 0 ? (
                <div className="overflow-x-auto pb-1">
                  {/* Wrapper forces the SVG and Text to share the same responsive width */}
                  <div style={{ minWidth: `max(100%, ${monthlyData.length * 45}px)` }}>
                    <VBars data={monthlyData} height={200} />
                    {/* Same flex-1 and 2.5% padding trick to guarantee perfect center alignment */}
                    <div className="mt-2 flex w-full" style={{ padding: '0 2.5%' }}>
                      {monthlyData.map(d => (
                        <div key={d.label} className="flex-1 text-center">
                          <div className={`text-[10px] font-mono leading-none ${pnlColor(d.value)}`}>
                            {fmtShort(d.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No data</div>
              )}
            </div>
          </div>
        )}

        {/* ── Strategy breakdown ──────────────────────────────────────────── */}
        {stats && stratData.length > 1 && (
          <div className={`${CARD} p-4`}>
            <div className={`${SECTION_LABEL} mb-3`}>Performance by Strategy</div>
            <div className="space-y-1.5">
              {stratData.map(({ name, pnl, count, winRate: wr }) => (
                <div key={name} className="flex items-center gap-2 py-0.5">
                  <span className="w-28 text-xs font-mono text-foreground shrink-0 truncate">{name}</span>
                  <div className="flex-1 h-3.5 bg-muted/20 overflow-hidden">
                    <div
                      className={`h-full ${pnl >= 0 ? 'bg-emerald-500/40' : 'bg-rose-500/40'}`}
                      style={{ width: `${(Math.abs(pnl) / maxStratPnl) * 100}%` }}
                    />
                  </div>
                  <span className={`w-20 text-xs font-mono text-right ${pnlColor(pnl)}`}>
                    {dollar(pnl)}
                  </span>
                  <span className="w-24 text-[10px] text-muted-foreground text-right shrink-0">
                    {count}t · {pct(wr)} WR
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Duration ────────────────────────────────────────────────────── */}
        {stats && durationData.buckets.length > 0 && (
          <div className={`${CARD} p-4`}>
            <div className={`${SECTION_LABEL} mb-3`}>Trade Duration</div>
            <div className="flex gap-6 mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Win Hold</div>
                <div className="text-sm font-bold font-mono text-emerald-400">{fmtMins(durationData.avgWin)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Loss Hold</div>
                <div className="text-sm font-bold font-mono text-rose-500">{fmtMins(durationData.avgLoss)}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {durationData.buckets.map(b => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className="w-14 text-[10px] font-mono text-muted-foreground shrink-0">{b.label}</span>
                  <div className="flex-1 h-3 bg-muted/20 overflow-hidden">
                    <div
                      className={`h-full ${b.winRate >= 50 ? 'bg-emerald-500/55' : 'bg-rose-500/55'}`}
                      style={{ width: `${b.winRate}%` }}
                    />
                  </div>
                  <span className={`w-10 text-[10px] font-mono text-right shrink-0 ${b.winRate >= 50 ? 'text-emerald-400' : 'text-rose-500'}`}>
                    {pct(b.winRate)}
                  </span>
                  <span className="w-8 text-[10px] text-muted-foreground text-right shrink-0">{b.count}t</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Time of Day ──────────────────────────────────────────────────── */}
        {stats && todData.length > 0 && (
          <div className={`${CARD} p-4`}>
            <div className={`${SECTION_LABEL} mb-3`}>P&L by Time of Day</div>
            <div className="space-y-0.5">
              {todData.map(d => (
                <div key={d.label} className="flex items-center gap-2 py-0.5">
                  <span className="w-24 text-[10px] font-mono text-muted-foreground shrink-0">{d.label}</span>
                  <div className="flex-1 h-3 bg-muted/20 overflow-hidden">
                    <div
                      className={`h-full ${d.value >= 0 ? 'bg-emerald-500/50' : 'bg-rose-500/50'}`}
                      style={{ width: `${(Math.abs(d.value) / maxTodPnl) * 100}%` }}
                    />
                  </div>
                  <span className={`w-16 text-[10px] font-mono text-right shrink-0 ${pnlColor(d.value)}`}>
                    {fmtShort(d.value)}
                  </span>
                  <span className="w-16 text-[10px] text-muted-foreground text-right shrink-0">
                    {d.count}t · {Math.round(d.winRate)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Best / Worst Trades ─────────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { title: 'Best Trades', list: stats.topTrades.best, color: 'text-emerald-400' },
              { title: 'Worst Trades', list: stats.topTrades.worst, color: 'text-rose-500' },
            ].map(({ title, list, color }) => (
              <div key={title} className={`${CARD} p-4`}>
                <div className={`${SECTION_LABEL} mb-3`}>{title}</div>
                <div className="space-y-0">
                  {list.map((t, i) => (
                    <div key={t.id}
                      onClick={() => setChartTrade(t)}
                      className="flex items-center justify-between py-2 border-b border-border/40 last:border-0 cursor-pointer hover:bg-accent/40 transition-colors -mx-2 px-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted-foreground font-mono w-4 shrink-0">{i + 1}.</span>
                        <span className="text-xs font-bold font-mono text-foreground">{t.ticker}</span>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {t.option_type} ${t.strike} · {t.expiry?.slice(5)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <span className="text-[10px] text-muted-foreground font-mono">{t.date}</span>
                        <span className={`text-xs font-bold font-mono w-20 text-right ${color}`}>
                          {dollar(t.total_pnl)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!list.length && <div className="text-sm text-muted-foreground">No data</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* bottom padding */}
        <div className="h-2" />

        </> /* end overview tab */}

      </div>
    </div>

    {chartTrade && (
      <TradeChart trade={chartTrade} onClose={() => setChartTrade(null)} />
    )}
    {showMC && (
      <MonteCarloModal trades={allClosed} onClose={() => setShowMC(false)} />
    )}
    </>
  )
}

// ── Strategy Comparison ───────────────────────────────────────────────────────

function stratStats(trades) {
  if (!trades.length) return null
  const wins   = trades.filter(t => t.total_pnl > 0)
  const losses = trades.filter(t => t.total_pnl <= 0)
  const totalPnl     = trades.reduce((s, t) => s + t.total_pnl, 0)
  const avgWin       = wins.length   ? wins.reduce((s, t)   => s + t.total_pnl, 0) / wins.length   : 0
  const avgLoss      = losses.length ? losses.reduce((s, t) => s + t.total_pnl, 0) / losses.length : 0
  const grossWin     = wins.reduce((s, t) => s + t.total_pnl, 0)
  const grossLoss    = Math.abs(losses.reduce((s, t) => s + t.total_pnl, 0))
  const winRate      = (wins.length / trades.length) * 100
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? Infinity : 0
  const expectancy   = (winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss

  let peak = 0, equity = 0, maxDrawdown = 0
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  for (const t of sorted) {
    equity += t.total_pnl
    if (equity > peak) peak = equity
    maxDrawdown = Math.max(maxDrawdown, peak - equity)
  }
  return { totalPnl, winRate, avgWin, avgLoss, profitFactor, expectancy, maxDrawdown, wins: wins.length, losses: losses.length, total: trades.length }
}

function StrategyComparison({ allTrades, strategies }) {
  const closed = allTrades.filter(t => t.status === 'closed')
  const cols = [
    { key: '', label: 'All' },
    ...strategies.map(s => ({ key: s, label: s })),
  ]

  const data = cols.map(({ key, label }) => {
    const trades = key ? closed.filter(t => t.strategy === key) : closed
    return { label, stats: stratStats(trades) }
  })

  const rows = [
    { label: 'Trades',        fmt: (s) => s.total },
    { label: 'Win Rate',      fmt: (s) => `${s.winRate.toFixed(1)}%`,            color: (s) => s.winRate >= 50 ? 'text-emerald-400' : 'text-rose-500' },
    { label: 'Profit Factor', fmt: (s) => isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞', color: (s) => s.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-500' },
    { label: 'Expectancy',    fmt: (s) => dollar(s.expectancy),                  color: (s) => pnlColor(s.expectancy) },
    { label: 'Avg Win',       fmt: (s) => dollar(s.avgWin),                      color: () => 'text-emerald-400' },
    { label: 'Avg Loss',      fmt: (s) => dollar(s.avgLoss),                     color: () => 'text-rose-500' },
    { label: 'Max Drawdown',  fmt: (s) => dollar(-s.maxDrawdown),                color: () => 'text-rose-500' },
    { label: 'Net P&L',       fmt: (s) => dollar(s.totalPnl),                    color: (s) => pnlColor(s.totalPnl) },
  ]

  if (!closed.length) return (
    <div className={`${CARD} p-12 text-center text-sm text-muted-foreground`}>No closed trades yet.</div>
  )

  return (
    <div className={`${CARD} overflow-x-auto`}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground w-28">Metric</th>
            {data.map(({ label }) => (
              <th key={label} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-foreground text-right">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, fmt, color }) => (
            <tr key={label} className="border-b border-border/40 last:border-0 hover:bg-accent/20 transition-colors">
              <td className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</td>
              {data.map(({ label: colLabel, stats: s }) => (
                <td key={colLabel} className={`px-4 py-2.5 font-mono text-right ${s ? (color ? color(s) : 'text-foreground') : 'text-muted-foreground/30'}`}>
                  {s ? fmt(s) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Monte Carlo Modal ─────────────────────────────────────────────────────────

function MonteCarloModal({ trades, onClose }) {
  const [numTrades, setNumTrades]   = useState(100)
  const [numSims,   setNumSims]     = useState(1000)
  const [result,    setResult]      = useState(null)
  const [running,   setRunning]     = useState(false)

  const pnls = trades.map(t => t.total_pnl)

  const run = () => {
    if (!pnls.length) return
    setRunning(true)
    setTimeout(() => {
      const finals = [], maxDDs = []
      for (let s = 0; s < numSims; s++) {
        let equity = 0, peak = 0, maxDD = 0
        for (let i = 0; i < numTrades; i++) {
          equity += pnls[Math.floor(Math.random() * pnls.length)]
          if (equity > peak) peak = equity
          maxDD = Math.max(maxDD, peak - equity)
        }
        finals.push(equity)
        maxDDs.push(maxDD)
      }
      finals.sort((a, b) => a - b)
      maxDDs.sort((a, b) => a - b)
      const p = (arr, pct) => arr[Math.floor(arr.length * pct)]
      setResult({
        p10: p(finals, 0.10), p25: p(finals, 0.25),
        p50: p(finals, 0.50), p75: p(finals, 0.75), p90: p(finals, 0.90),
        probProfit: finals.filter(v => v > 0).length / finals.length * 100,
        maxDD_p50: p(maxDDs, 0.50), maxDD_p90: p(maxDDs, 0.90),
      })
      setRunning(false)
    }, 0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-foreground">Monte Carlo Simulation</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground">Randomly samples your {pnls.length} historical trade P&Ls to simulate possible future outcomes.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Future trades</label>
              <input type="number" min={10} max={500} value={numTrades} onChange={e => setNumTrades(+e.target.value)}
                className="w-full border border-border bg-muted/30 px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Simulations</label>
              <input type="number" min={100} max={10000} step={100} value={numSims} onChange={e => setNumSims(+e.target.value)}
                className="w-full border border-border bg-muted/30 px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors" />
            </div>
          </div>
          <button onClick={run} disabled={running || !pnls.length}
            className="w-full py-2.5 text-xs font-bold uppercase tracking-wider bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40">
            {running ? 'Running…' : 'Run Simulation'}
          </button>

          {result && (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-2">Final P&L Distribution (after {numTrades} trades)</p>
                <div className="grid grid-cols-5 gap-1 text-center">
                  {[['10th', result.p10], ['25th', result.p25], ['50th', result.p50], ['75th', result.p75], ['90th', result.p90]].map(([pct, val]) => (
                    <div key={pct} className={`border border-border px-2 py-2 ${CARD}`}>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{pct}%</div>
                      <div className={`text-xs font-bold font-mono ${pnlColor(val)}`}>{dollar(val)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className={`${CARD} border border-border p-3 text-center`}>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Prob. Profitable</div>
                  <div className={`text-sm font-bold font-mono ${result.probProfit >= 50 ? 'text-emerald-400' : 'text-rose-500'}`}>{result.probProfit.toFixed(1)}%</div>
                </div>
                <div className={`${CARD} border border-border p-3 text-center`}>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Median Max DD</div>
                  <div className="text-sm font-bold font-mono text-rose-500">{dollar(-result.maxDD_p50)}</div>
                </div>
                <div className={`${CARD} border border-border p-3 text-center`}>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">90th% Max DD</div>
                  <div className="text-sm font-bold font-mono text-rose-500">{dollar(-result.maxDD_p90)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
