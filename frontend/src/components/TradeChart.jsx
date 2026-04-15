import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, CrosshairMode, LineStyle, PriceScaleMode, TickMarkType } from 'lightweight-charts'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getChartData, getYahooFallback, uploadChartCsv, saveYahooDay, deleteChartDay, updateTrade, addExit, updateExit, deleteExit, getTrades } from '../api'
import { X, Upload, AlertCircle, BarChart2, ChevronDown, ChevronUp, Pencil, Trash2, Plus, Check, Copy } from 'lucide-react'
import { getChartSettings } from '../chartSettings'
import { getTimezone } from '../timezone'

// ── Helpers ────────────────────────────────────────────────────────────────────

const TF_OPTS = [
  { label: '1m', min: 1 }, { label: '5m', min: 5 },
  { label: '15m', min: 15 }, { label: '30m', min: 30 }, { label: '1H', min: 60 },
  { label: '4H', min: 240 }, { label: '1D', min: 1440 },
]

function aggregate(candles, minutes) {
  if (minutes === 1) return candles
  const buckets = new Map()
  for (const c of candles) {
    const key = Math.floor(c.ts / (minutes * 60)) * (minutes * 60)
    if (!buckets.has(key)) { buckets.set(key, { ...c, ts: key }) }
    else {
      const b = buckets.get(key)
      b.high = Math.max(b.high, c.high); b.low = Math.min(b.low, c.low)
      b.close = c.close; b.volume = (b.volume || 0) + (c.volume || 0)
      for (const k of ['vwap','ma1','ma2','ma3','ma4','macd_hist','macd','macd_signal','rsi','cci','cci_ma'])
        if (c[k] != null) b[k] = c[k]
      if (c.buy_signal) b.buy_signal = 1
      if (c.sell_signal) b.sell_signal = 1
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts)
}

function alignData(denseMain, sparseSecondary) {
  if (!denseMain.length || !sparseSecondary.length) return sparseSecondary
  const secMap = new Map()
  sparseSecondary.forEach(c => secMap.set(c.ts, c))
  
  const aligned = []
  let lastVal = sparseSecondary[0] 
  
  for (const mc of denseMain) {
    if (secMap.has(mc.ts)) {
      lastVal = secMap.get(mc.ts)
      aligned.push(lastVal)
    } else {
      aligned.push({
        ts: mc.ts,
        open: lastVal.close,
        high: lastVal.close,
        low: lastVal.close,
        close: lastVal.close,
        volume: 0
      })
    }
  }
  return aligned
}

function tzUtcOffsetHours(date) {
  const probe = new Date(date + 'T12:00:00Z')
  return parseInt(probe.toLocaleTimeString('en-US', { timeZone: getTimezone(), hour: '2-digit', hour12: false })) - 12
}
function tradeTimeToTs(date, time) {
  const t = time.includes(':') ? time : time.slice(0, 2) + ':' + time.slice(2)
  const [h = 0, m = 0, s = 0] = t.split(':').map(Number)
  const base = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000)
  return base + h * 3600 + m * 60 + s - tzUtcOffsetHours(date) * 3600
}
function nearestTs(target, candles) {
  if (!candles.length) return null
  return candles.reduce((b, c) => Math.abs(c.ts - target) < Math.abs(b.ts - target) ? c : b).ts
}
function tzTimeLabel(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en-US', { timeZone: getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false })
}
function tickFormatter(ts, type) {
  const d = new Date(ts * 1000)
  if (type === TickMarkType.Year) {
    return d.toLocaleDateString('en-US', { timeZone: getTimezone(), year: 'numeric' })
  }
  if (type === TickMarkType.Month) {
    return d.toLocaleDateString('en-US', { timeZone: getTimezone(), month: 'short' })
  }
  if (type === TickMarkType.DayOfMonth) {
    return d.toLocaleDateString('en-US', { timeZone: getTimezone(), month: 'short', day: 'numeric' })
  }
  return tzTimeLabel(ts)
}

function parseNoteSections(value, exitCount = 0) {
  const text = (value ?? '').replace(/\r/g, '')
  const lines = text.split('\n')
  const sections = { entry: '', notes: '' }
  for (let i = 1; i <= exitCount; i++) sections[`exit${i}`] = ''
  let current = null

  for (const line of lines) {
    const normalized = line.trim().toLowerCase()
    if (normalized === 'entry:') { current = 'entry'; continue }
    if (normalized === 'notes:') { current = 'notes'; continue }
    const m = normalized.match(/^exit\s+(\d+):$/)
    if (m) { current = `exit${m[1]}`; if (!(current in sections)) sections[current] = ''; continue }
    if (current != null) sections[current] = sections[current] ? `${sections[current]}\n${line}` : line
  }

  // Legacy single "Exit:" header — fold into exit1
  if (!sections.exit1) {
    const legacyMatch = text.match(/^Exit:\n([\s\S]*?)(?=\n\n[A-Z]|\n*$)/im)
    if (legacyMatch) sections.exit1 = legacyMatch[1].trim()
  }

  // Fallback: unstructured text → notes
  const hasStructure = Object.values(sections).some(v => v.trim())
  if (!hasStructure && text.trim()) sections.notes = text.trim()

  for (const k of Object.keys(sections)) sections[k] = (sections[k] ?? '').trim()
  return sections
}

function buildNoteSections(sections, exitCount) {
  const parts = [`Entry:\n${(sections.entry ?? '').trim()}`]
  for (let i = 1; i <= exitCount; i++) parts.push(`Exit ${i}:\n${(sections[`exit${i}`] ?? '').trim()}`)
  parts.push(`Notes:\n${(sections.notes ?? '').trim()}`)
  return parts.join('\n\n').trim()
}

// ── Theme ──────────────────────────────────────────────────────────────────────
const BG = '#07090f'; const CARD_BG = '#0c0f1c'; const GRID = '#121626'
const TEXT = '#5a6a8a'; const BORD = '#1c2440'

const INPUT_CLS = 'w-full border border-[#1c2440] bg-[#07090f] px-2 py-1.5 text-xs font-mono text-white/80 focus:outline-none focus:border-[#3b4a6b] transition-colors placeholder:text-white/20'
const LABEL_CLS = 'block text-[9px] font-bold uppercase tracking-[0.14em] text-white/30 mb-1'

function chartOpts(hideTime = false) {
  return {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: CARD_BG }, textColor: TEXT },
    grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
    crosshair: { mode: CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    timeScale: { borderColor: BORD, timeVisible: true, secondsVisible: false, visible: !hideTime, tickMarkFormatter: (ts, type) => tickFormatter(ts, type) },
    rightPriceScale: { borderColor: BORD },
  }
}

function buildMarkers(trade, candles, isYahoo) {
  if (!candles.length) return []
  const m = []
  const ne = nearestTs(tradeTimeToTs(trade.date, trade.time), candles)
  if (ne != null) m.push({ time: ne, position: 'belowBar', color: '#22c55e', shape: 'arrowUp', text: `Entry $${trade.fill}` })
  for (const ex of trade.exits) {
    const net = nearestTs(tradeTimeToTs(trade.date, ex.time), candles)
    if (net != null) {
      const ps = ex.pnl >= 0 ? `+$${ex.pnl.toFixed(0)}` : `-$${Math.abs(ex.pnl).toFixed(0)}`
      m.push({ time: net, position: 'aboveBar', color: ex.pnl >= 0 ? '#22c55e' : '#ef4444', shape: 'arrowDown', text: `Exit $${ex.price.toFixed(2)} (${ps})` })
    }
  }
  if (!isYahoo) {
    for (const c of candles) {
      if (c.buy_signal)  m.push({ time: c.ts, position: 'belowBar', color: '#3b82f6', shape: 'circle', text: 'B' })
      if (c.sell_signal) m.push({ time: c.ts, position: 'aboveBar', color: '#f97316', shape: 'circle', text: 'S' })
    }
  }
  return m.sort((a, b) => a.time - b.time)
}

function ChartOverlayBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`text-[9px] font-bold px-1.5 py-0.5 border transition-colors leading-none ${
      active ? 'border-primary/50 bg-primary/20 text-primary' : 'border-white/10 bg-black/50 text-white/35 hover:text-white/70 hover:border-white/20'
    }`}>{children}</button>
  )
}

function PaneHeader({ label, collapsed, onToggle }) {
  return (
    <div onClick={onToggle} className="flex items-center justify-between px-3 cursor-pointer select-none shrink-0"
      style={{ height: 28, borderTop: `1px solid ${BORD}`, background: BG }}>
      <span className="text-xs font-medium text-white/40">{label}</span>
      {collapsed ? <ChevronUp className="w-3 h-3 text-white/40" /> : <ChevronDown className="w-3 h-3 text-white/40" />}
    </div>
  )
}

function IndToggle({ active, color, label, onToggle }) {
  return (
    <button onClick={onToggle} className={`flex items-center gap-1.5 transition-opacity ${active ? 'opacity-100' : 'opacity-30'}`}>
      <span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />
      <span>{label}</span>
    </button>
  )
}

// ── Option symbol formatter ─────────────────────────────────────────────────
function formatOptionSymbol(trade) {
  const raw = trade.expiry.replace(/-/g, '')          // "20260326"
  const yymmdd = raw.length === 8 ? raw.slice(2) : raw // "260326"
  const type = trade.option_type === 'Call' ? 'C' : 'P'
  const strike = Number(trade.strike) % 1 === 0 ? `${trade.strike}.0` : String(trade.strike)
  return `${trade.ticker}${yymmdd}${type}${strike}`
}

function OptionSymbolChip({ trade }) {
  const [copied, setCopied] = useState(false)
  const symbol = formatOptionSymbol(trade)
  const copy = () => {
    navigator.clipboard.writeText(symbol)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
      <span className="font-mono text-xs flex-1 select-all" style={{ color: 'rgba(255,255,255,0.45)', letterSpacing: '0.02em' }}>{symbol}</span>
      <button onClick={copy} title="Copy symbol" style={{ color: copied ? '#4ade80' : 'rgba(255,255,255,0.25)' }} className="hover:opacity-80 transition-colors shrink-0">
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  )
}

// ── Notes Panel ────────────────────────────────────────────────────────────────
const NOTES_TA = 'w-full resize-none bg-transparent border border-white/8 px-2.5 py-2 text-xs text-white/70 focus:outline-none focus:border-white/20 transition-colors placeholder:text-white/15 leading-relaxed'

function NotesPanel({ trade, onRefresh }) {
  const qc = useQueryClient()
  const exitCount = trade.exits.length
  const [sections, setSections] = useState(() => parseNoteSections(trade.notes, exitCount))
  const [saved, setSaved] = useState(false)

  // Sync when notes or exit count changes from outside
  useEffect(() => {
    setSections(parseNoteSections(trade.notes, exitCount))
  }, [trade.notes, exitCount])

  const setSection = key => e => setSections(prev => ({ ...prev, [key]: e.target.value }))

  const built = buildNoteSections(sections, exitCount)
  const original = buildNoteSections(parseNoteSections(trade.notes, exitCount), exitCount)

  const mut = useMutation({
    mutationFn: () => updateTrade(trade.id, {
      date: trade.date, time: trade.time,
      fill: trade.fill, qty: trade.qty,
      total_cost: trade.total_cost,
      strategy: trade.strategy || null,
      notes: built || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      onRefresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    },
  })

  return (
    <div className="flex flex-col h-full" style={{ width: 240, flexShrink: 0, borderLeft: `1px solid ${BORD}`, background: BG }}>
      <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: `1px solid ${BORD}` }}>
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25">Notes</p>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col p-3 gap-3 min-h-0">
        {/* Option symbol chip */}
        <OptionSymbolChip trade={trade} />

        {/* Entry */}
        <div className="space-y-1">
          <label className={LABEL_CLS}>Entry</label>
          <textarea rows={3} className={NOTES_TA} placeholder="Entry reasoning…"
            value={sections.entry} onChange={setSection('entry')} />
        </div>

        {/* One card per exit */}
        {trade.exits.map((ex, i) => {
          const n = i + 1
          const isPos = ex.pnl >= 0
          const pnlStr = isPos ? `+$${ex.pnl.toFixed(0)}` : `-$${Math.abs(ex.pnl).toFixed(0)}`
          return (
            <div key={ex.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <label className={LABEL_CLS} style={{ marginBottom: 0 }}>Exit {n}</label>
                <span className="text-[9px] font-mono" style={{ color: '#ffffff25' }}>
                  {ex.time} · ${ex.price.toFixed(2)} · <span style={{ color: isPos ? '#4ade8066' : '#f8717166' }}>{pnlStr}</span>
                </span>
              </div>
              <textarea rows={3} className={NOTES_TA} placeholder={`Why did you exit here?`}
                value={sections[`exit${n}`] ?? ''} onChange={setSection(`exit${n}`)} />
            </div>
          )
        })}

        {/* General notes */}
        <div className="space-y-1">
          <label className={LABEL_CLS}>General Notes</label>
          <textarea rows={3} className={NOTES_TA} placeholder="Anything else…"
            value={sections.notes} onChange={setSection('notes')} />
        </div>

        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending || built === original}
          className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors disabled:opacity-30 shrink-0"
          style={{
            background: saved ? '#16a34a22' : '#e8a03018',
            color: saved ? '#4ade80' : '#e8a030',
            border: `1px solid ${saved ? '#16a34a44' : '#e8a03033'}`,
          }}
        >
          {saved ? <><Check className="w-3 h-3" /> Saved</> : mut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Edit Panel ─────────────────────────────────────────────────────────────────
function EditPanel({ trade, onRefresh }) {
  const qc = useQueryClient()

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['trades'] })
    qc.invalidateQueries({ queryKey: ['stats-overview'] })
    qc.invalidateQueries({ queryKey: ['stats-calendar'] })
  }

  const [entry, setEntry] = useState({
    date: trade.date, time: trade.time,
    ticker: trade.ticker,
    fill: String(trade.fill), qty: String(trade.qty),
    strategy: trade.strategy ?? '', notes: trade.notes ?? '',
  })
  const [entrySaved, setEntrySaved] = useState(false)

  useEffect(() => {
    setEntry(f => ({ ...f, notes: trade.notes ?? '', strategy: trade.strategy ?? '' }))
  }, [trade.notes, trade.strategy])
  
  const setE = k => e => setEntry(f => ({ ...f, [k]: e.target.value }))

  const entryMut = useMutation({
    mutationFn: () => updateTrade(trade.id, {
      date: entry.date, time: entry.time,
      ticker: entry.ticker.toUpperCase(),
      fill: parseFloat(entry.fill), qty: parseInt(entry.qty),
      total_cost: parseFloat(entry.fill) * parseInt(entry.qty) * 100,
      strategy: entry.strategy || null, notes: entry.notes || null,
    }),
    onSuccess: () => { invalidateAll(); onRefresh(); setEntrySaved(true); setTimeout(() => setEntrySaved(false), 1500) },
  })

  const [exitForms, setExitForms] = useState(
    trade.exits.map(e => ({ id: e.id, time: e.time, price: String(e.price), qty: String(e.qty), origPnl: e.pnl }))
  )

  useEffect(() => {
    setExitForms(trade.exits.map(e => ({ id: e.id, time: e.time, price: String(e.price), qty: String(e.qty), origPnl: e.pnl })))
  }, [trade.exits.length])

  const [savedExitId, setSavedExitId] = useState(null)
  const setEx = (id, k) => e => setExitForms(fs => fs.map(f => f.id === id ? { ...f, [k]: e.target.value } : f))

  const exitSaveMut = useMutation({
    mutationFn: ({ id, time, price, qty }) => updateExit(id, { time, price: parseFloat(price), qty: parseInt(qty) }),
    onSuccess: (_, v) => { invalidateAll(); onRefresh(); setSavedExitId(v.id); setTimeout(() => setSavedExitId(null), 1500) },
  })
  const exitDelMut = useMutation({
    mutationFn: id => deleteExit(id),
    onSuccess: () => { invalidateAll(); onRefresh() },
  })

  const totalExited = trade.exits.reduce((s, e) => s + e.qty, 0)
  const remaining   = trade.qty - totalExited
  const [newEx, setNewEx] = useState({ time: '', price: '', qty: '' })
  const setNE = k => e => setNewEx(f => ({ ...f, [k]: e.target.value }))
  const newPreview = newEx.price && newEx.qty ? (parseFloat(newEx.price) - trade.fill) * parseInt(newEx.qty) * 100 : null

  const newExMut = useMutation({
    mutationFn: () => addExit({ trade_id: trade.id, time: newEx.time, price: parseFloat(newEx.price), qty: parseInt(newEx.qty) }),
    onSuccess: () => { invalidateAll(); onRefresh(); setNewEx({ time: '', price: '', qty: '' }) },
  })

  const saveBtn = (label, isPending, isSaved, onClick, accentGreen = false) => (
    <button onClick={onClick} disabled={isPending}
      className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors disabled:opacity-40"
      style={{
        background: isSaved ? '#16a34a22' : accentGreen ? '#22c55e18' : '#ffffff0a',
        color: isSaved ? '#4ade80' : accentGreen ? '#4ade80' : '#ffffff50',
        border: `1px solid ${isSaved ? '#16a34a44' : accentGreen ? '#22c55e33' : BORD}`,
      }}>
      {isSaved ? <><Check className="w-3 h-3" /> Saved</> : isPending ? 'Saving…' : label}
    </button>
  )

  return (
    <div className="flex flex-col h-full overflow-y-auto text-white/70" style={{ background: BG, borderLeft: `1px solid ${BORD}` }}>
      <div className="shrink-0 px-4 pt-4 pb-4" style={{ borderBottom: `1px solid ${BORD}` }}>
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 mb-3">Entry</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className={LABEL_CLS}>Date</label><input className={INPUT_CLS} type="date" value={entry.date} onChange={setE('date')} /></div>
          <div><label className={LABEL_CLS}>Time ET</label><input className={INPUT_CLS} value={entry.time} onChange={setE('time')} placeholder="HH:MM" /></div>
        </div>
        <div className="mb-2">
          <label className={LABEL_CLS}>Ticker</label>
          <input
            className={INPUT_CLS}
            value={entry.ticker}
            onChange={e => setEntry(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
            placeholder="SPY"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className={LABEL_CLS}>Fill $</label><input className={INPUT_CLS} type="number" step="0.01" value={entry.fill} onChange={setE('fill')} /></div>
          <div><label className={LABEL_CLS}>Qty</label><input className={INPUT_CLS} type="number" min="1" value={entry.qty} onChange={setE('qty')} /></div>
        </div>
        <div className="mb-2"><label className={LABEL_CLS}>Strategy</label><input className={INPUT_CLS} value={entry.strategy} onChange={setE('strategy')} placeholder="optional" /></div>
        <div className="mb-3"><label className={LABEL_CLS}>Notes</label><textarea className={`${INPUT_CLS} resize-none`} rows={2} value={entry.notes} onChange={setE('notes')} placeholder="optional" /></div>
        {entryMut.error && <p className="text-[10px] text-rose-400 mb-2">{entryMut.error.message}</p>}
        <button onClick={() => entryMut.mutate()} disabled={entryMut.isPending}
          className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
          style={{ background: entrySaved ? '#16a34a22' : '#e8a03018', color: entrySaved ? '#4ade80' : '#e8a030', border: `1px solid ${entrySaved ? '#16a34a44' : '#e8a03033'}` }}>
          {entrySaved ? <><Check className="w-3 h-3" /> Saved</> : entryMut.isPending ? 'Saving…' : 'Save Entry'}
        </button>
      </div>

      <div className="flex-1 px-4 pt-3 pb-4">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 mb-3">
          Exits <span className="font-normal normal-case tracking-normal text-white/20">
            {remaining > 0 ? `· ${remaining} remaining` : '· fully closed'}
          </span>
        </p>

        <div className="space-y-3">
          {exitForms.map(f => {
            const preview = f.price && f.qty ? (parseFloat(f.price) - trade.fill) * parseInt(f.qty) * 100 : f.origPnl
            const isPos   = preview >= 0
            return (
              <div key={f.id} className="space-y-2 pb-3" style={{ borderBottom: `1px solid ${BORD}` }}>
                <div className="grid grid-cols-3 gap-1.5">
                  <div><label className={LABEL_CLS}>Time ET</label><input className={INPUT_CLS} value={f.time} onChange={setEx(f.id, 'time')} /></div>
                  <div><label className={LABEL_CLS}>Price $</label><input className={INPUT_CLS} type="number" step="0.01" value={f.price} onChange={setEx(f.id, 'price')} /></div>
                  <div><label className={LABEL_CLS}>Qty</label><input className={INPUT_CLS} type="number" min="1" value={f.qty} onChange={setEx(f.id, 'qty')} /></div>
                </div>
                {preview != null && (
                  <div className="font-mono text-xs font-semibold px-2 py-1" style={{
                    background: isPos ? '#22c55e11' : '#ef444411',
                    color: isPos ? '#4ade80' : '#f87171',
                    border: `1px solid ${isPos ? '#22c55e22' : '#ef444422'}`,
                  }}>
                    {isPos ? '+' : ''}${preview.toFixed(2)}
                  </div>
                )}
                <div className="flex gap-1.5">
                  {saveBtn('Save', exitSaveMut.isPending, savedExitId === f.id, () => exitSaveMut.mutate({ id: f.id, time: f.time, price: f.price, qty: f.qty }))}
                  <button onClick={() => window.confirm('Delete this exit?') && exitDelMut.mutate(f.id)}
                    className="px-2.5 py-1 transition-colors"
                    style={{ background: '#ef444411', color: '#f87171aa', border: '1px solid #ef444422' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {remaining > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/20">Add Exit</p>
            <div className="grid grid-cols-3 gap-1.5">
              <div><label className={LABEL_CLS}>Time ET</label><input className={INPUT_CLS} value={newEx.time} onChange={setNE('time')} placeholder="HH:MM" /></div>
              <div><label className={LABEL_CLS}>Price $</label><input className={INPUT_CLS} type="number" step="0.01" value={newEx.price} onChange={setNE('price')} /></div>
              <div><label className={LABEL_CLS}>Qty (max {remaining})</label><input className={INPUT_CLS} type="number" min="1" max={remaining} value={newEx.qty} onChange={setNE('qty')} /></div>
            </div>
            {newPreview != null && (
              <div className="font-mono text-xs font-semibold px-2 py-1" style={{
                background: newPreview >= 0 ? '#22c55e11' : '#ef444411',
                color: newPreview >= 0 ? '#4ade80' : '#f87171',
                border: `1px solid ${newPreview >= 0 ? '#22c55e22' : '#ef444422'}`,
              }}>
                {newPreview >= 0 ? '+' : ''}${newPreview.toFixed(2)}
              </div>
            )}
            {newExMut.error && <p className="text-[10px] text-rose-400">{newExMut.error.message}</p>}
            <button onClick={() => newExMut.mutate()}
              disabled={!newEx.time || !newEx.price || !newEx.qty || newExMut.isPending}
              className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
              style={{ background: '#22c55e18', color: '#4ade80', border: '1px solid #22c55e33' }}>
              <Plus className="w-3 h-3" />{newExMut.isPending ? 'Adding…' : 'Add Exit'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TradeChart({ trade: initialTrade, onClose, defaultEditOpen = false }) {
  const qc = useQueryClient()
  const [tfIdx, setTfIdx]         = useState(0)
  const [uploading, setUploading] = useState(false)
  const [savingYahoo, setSavingYahoo] = useState(false)
  const [removingTickerCsv, setRemovingTickerCsv] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [collapsed,       setCollapsed]       = useState({ macd: false, rsi: false, option: false })
  const [paneH,           setPaneH]           = useState({ macd: 112, rsi: 96 })
  const [uploadingOption, setUploadingOption] = useState(false)
  const [removingOptionCsv, setRemovingOptionCsv] = useState(false)
  const [confirmRemoveOption, setConfirmRemoveOption] = useState(false)
  const [logScale,  setLogScale]  = useState(false)
  const [logMacd,   setLogMacd]   = useState(false)
  const [logRsi,    setLogRsi]    = useState(false)
  const [logOption, setLogOption] = useState(false)
  const [fitPrice,  setFitPrice]  = useState(false)
  const [fitMacd,   setFitMacd]   = useState(false)
  const [fitRsi,    setFitRsi]    = useState(false)
  const [fitOption, setFitOption] = useState(false)
  const [inds, setInds]           = useState({ vwap: true, ma1: true, ma2: true, ma3: true, ma4: true })
  const [editOpen, setEditOpen]   = useState(defaultEditOpen)
  const [ohlcInfo, setOhlcInfo]         = useState(null)
  const [optionOhlcInfo, setOptionOhlcInfo] = useState(null)

  const { data: allTrades = [] } = useQuery({ queryKey: ['trades'], queryFn: () => getTrades() })
  const trade = allTrades.find(t => t.id === initialTrade.id) ?? initialTrade

  const priceEl = useRef(null); const macdEl = useRef(null); const rsiEl = useRef(null); const optionEl = useRef(null)
  const chartsRef   = useRef([])
  const priceRef    = useRef(null)
  const oChartRef   = useRef(null)

  const vwapRef     = useRef(null)
  const maRefs      = useRef([null, null, null, null])
  const logScaleRef = useRef(false)
  const indsRef     = useRef({ vwap: true, ma1: true, ma2: true, ma3: true, ma4: true })

  useEffect(() => { logScaleRef.current = logScale }, [logScale])
  useEffect(() => { indsRef.current     = inds     }, [inds])

  useEffect(() => {
    priceRef.current?.priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
  }, [logScale])
  useEffect(() => {
    chartsRef.current[1]?.priceScale('right').applyOptions({ mode: logMacd ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
  }, [logMacd])
  useEffect(() => {
    chartsRef.current[2]?.priceScale('right').applyOptions({ mode: logRsi ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
  }, [logRsi])
  useEffect(() => {
    oChartRef.current?.priceScale('right').applyOptions({ mode: logOption ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
  }, [logOption])
  useEffect(() => {
    vwapRef.current?.applyOptions({ visible: inds.vwap })
    maRefs.current.forEach((s, i) => s?.applyOptions({ visible: inds[`ma${i + 1}`] }))
  }, [inds])

  const tradeDateBase = Math.floor(new Date(trade.date + 'T00:00:00Z').getTime() / 1000)
  const tfMin = TF_OPTS[tfIdx].min

  // Derive yahoo fetch range + interval from selected timeframe
  const { yahooStart, yahooEnd, yahooInterval } = (() => {
    const now = Math.floor(Date.now() / 1000)
    const eod = tradeDateBase + 21 * 3600  // trade date ~5pm ET
    if (tfMin >= 1440) {
      // 1D — 360 days of daily bars
      return { yahooStart: tradeDateBase - 360 * 86400, yahooEnd: now, yahooInterval: '1d' }
    } else if (tfMin >= 240) {
      // 4H — 180 days of 1h bars (aggregated to 4h in frontend)
      return { yahooStart: tradeDateBase - 180 * 86400, yahooEnd: now, yahooInterval: '1h' }
    } else if (tfMin >= 60) {
      // 1H — 180 days of 1h bars
      return { yahooStart: tradeDateBase - 180 * 86400, yahooEnd: now, yahooInterval: '1h' }
    } else if (tfMin >= 30) {
      // 30m — 60 days of 30m bars
      return { yahooStart: tradeDateBase - 60 * 86400, yahooEnd: now, yahooInterval: '30m' }
    } else if (tfMin >= 15) {
      // 15m — 30 days of 15m bars
      return { yahooStart: tradeDateBase - 30 * 86400, yahooEnd: now, yahooInterval: '15m' }
    } else if (tfMin >= 5) {
      // 5m — 14 days of 5m bars
      return { yahooStart: tradeDateBase - 14 * 86400, yahooEnd: now, yahooInterval: '5m' }
    } else {
      // 1m — 3-day window around trade date
      return { yahooStart: tradeDateBase - 2 * 86400 + 13 * 3600, yahooEnd: eod, yahooInterval: '1m' }
    }
  })()

  const startTs = tradeDateBase - 86400 + 13 * 3600
  const endTs   = tradeDateBase + 21 * 3600

  const { data: stored = [], isLoading: loadingStored, refetch } = useQuery({
    queryKey: ['chart-data', trade.ticker, trade.date],
    queryFn:  () => getChartData(trade.ticker, startTs, endTs),
  })
  const { data: yahoo = [], isLoading: loadingYahoo } = useQuery({
    queryKey: ['chart-yahoo', trade.ticker, trade.date, yahooInterval],
    queryFn:  () => getYahooFallback(trade.ticker, yahooStart, yahooEnd, yahooInterval),
    enabled:  !loadingStored && stored.length === 0,
  })

  // MAIN TICKER CANDLES
  const isYahoo    = stored.length === 0
  const rawCandles = isYahoo ? yahoo : stored
  const candles    = useMemo(() => aggregate(rawCandles, TF_OPTS[tfIdx].min), [rawCandles, tfIdx])
  const isLoading  = loadingStored || (isYahoo && loadingYahoo)
  const hasData    = candles.length > 0
  const showInds   = !isYahoo && hasData

  // OPTION TICKER CANDLES
  const optionTicker = `${trade.ticker}_${trade.option_type === 'Call' ? 'C' : 'P'}_${trade.strike}_${trade.expiry}`
  const { data: optionStored = [], refetch: refetchOption } = useQuery({
    queryKey: ['chart-data', optionTicker, trade.date],
    queryFn:  () => getChartData(optionTicker, startTs, endTs),
  })
  const rawOptionCandles  = useMemo(() => aggregate(optionStored, TF_OPTS[tfIdx].min), [optionStored, tfIdx])

  // Align option data to guarantee identical x-axis logic map
  const optionCandles = useMemo(() => alignData(candles, rawOptionCandles), [candles, rawOptionCandles])
  const hasOptionData  = optionCandles.length > 0

  useEffect(() => {
    chartsRef.current.forEach(c => { try { c.remove() } catch {} })
    chartsRef.current = []
    priceRef.current = null; vwapRef.current = null; maRefs.current = [null, null, null, null]

    if (!hasData || !priceEl.current || !macdEl.current || !rsiEl.current) return

    // UPDATED: Pass `false` to all chartOpts so the time scale remains visible at the bottom of every chart.
    const pChart = createChart(priceEl.current, chartOpts(false))
    const mChart = createChart(macdEl.current,  chartOpts(false))
    const rChart = createChart(rsiEl.current,   chartOpts(false))
    chartsRef.current = [pChart, mChart, rChart]
    priceRef.current  = pChart

    if (logScaleRef.current)
      pChart.priceScale('right').applyOptions({ mode: PriceScaleMode.Logarithmic })

    const cs = pChart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    cs.setData(candles.map(c => ({ time: c.ts, open: c.open, high: c.high, low: c.low, close: c.close })))
    cs.setMarkers(buildMarkers(trade, candles, isYahoo))

    const vs = pChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
    vs.setData(candles.map(c => ({ time: c.ts, value: c.volume || 0, color: c.close >= c.open ? '#22c55e2a' : '#ef44442a' })))
    pChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    const vd = candles.filter(c => c.vwap != null).map(c => ({ time: c.ts, value: c.vwap }))
    if (vd.length) {
      const vwapSeries = pChart.addLineSeries({ color: '#06b6d4', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: 'VWAP' })
      vwapSeries.setData(vd)
      vwapSeries.applyOptions({ visible: indsRef.current.vwap })
      vwapRef.current = vwapSeries
    }

    const maColors = ['#3b82f6', '#f59e0b', '#a855f7', '#f43f5e']
    ;['ma1','ma2','ma3','ma4'].forEach((k, i) => {
      const d = candles.filter(c => c[k] != null).map(c => ({ time: c.ts, value: c[k] }))
      if (!d.length) return
      const s = pChart.addLineSeries({ color: maColors[i], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: `MA${i+1}` })
      s.setData(d); s.applyOptions({ visible: indsRef.current[k] })
      maRefs.current[i] = s
    })

    if (showInds) {
      const hd = candles.filter(c => c.macd_hist != null).map(c => ({ time: c.ts, value: c.macd_hist, color: c.macd_hist >= 0 ? '#22c55e88' : '#ef444488' }))
      if (hd.length) mChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }).setData(hd)
      const md = candles.filter(c => c.macd != null).map(c => ({ time: c.ts, value: c.macd }))
      if (md.length) mChart.addLineSeries({ color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(md)
      const sd = candles.filter(c => c.macd_signal != null).map(c => ({ time: c.ts, value: c.macd_signal }))
      if (sd.length) mChart.addLineSeries({ color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(sd)

      const rd = candles.filter(c => c.rsi != null).map(c => ({ time: c.ts, value: c.rsi }))
      if (rd.length) {
        const rs = rChart.addLineSeries({ color: '#a78bfa', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false })
        rs.setData(rd)
        rs.createPriceLine({ price: 70, color: '#ef444466', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
        rs.createPriceLine({ price: 30, color: '#22c55e66', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
        rs.createPriceLine({ price: 50, color: '#6b728066', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false })
      }
    }

    let oChart = null
    let ocs = null
    if (hasOptionData && optionEl.current) {
      // UPDATED: Pass `false` to keep time visible
      oChart = createChart(optionEl.current, chartOpts(false))
      oChartRef.current = oChart
      chartsRef.current.push(oChart)
      ocs = oChart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      })
      ocs.setData(optionCandles.map(c => ({ time: c.ts, open: c.open, high: c.high, low: c.low, close: c.close })))

      // We pass the rawOptionCandles to the markers so it doesn't try to draw on a fake carry-over candle
      ocs.setMarkers(buildMarkers(trade, rawOptionCandles, true))
    }

    // OHLC info on crosshair hover
    pChart.subscribeCrosshairMove(params => {
      if (!params.time) { setOhlcInfo(null); return }
      const data = params.seriesData?.get(cs)
      setOhlcInfo(data && 'open' in data ? { open: data.open, high: data.high, low: data.low, close: data.close } : null)
    })
    if (oChart && ocs) {
      oChart.subscribeCrosshairMove(params => {
        if (!params.time) { setOptionOhlcInfo(null); return }
        const data = params.seriesData?.get(ocs)
        setOptionOhlcInfo(data && 'open' in data ? { open: data.open, high: data.high, low: data.low, close: data.close } : null)
      })
    }

    const all = showInds
      ? [pChart, ...(oChart ? [oChart] : []), mChart, rChart]
      : [pChart, ...(oChart ? [oChart] : [])]
    
    // LOGICAL-BASED SYNC ENGINE — range-key deduplication prevents feedback oscillation
    const rangeKey = r => `${Math.round(r.from * 1000)}:${Math.round(r.to * 1000)}`
    const lastRanges = new WeakMap()
    all.forEach((srcChart) => {
      srcChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return
        const key = rangeKey(range)
        if (lastRanges.get(srcChart) === key) return
        lastRanges.set(srcChart, key)
        all.forEach((dstChart) => {
          if (dstChart === srcChart) return
          if (lastRanges.get(dstChart) === key) return
          lastRanges.set(dstChart, key)
          try { dstChart.timeScale().setVisibleLogicalRange(range) } catch {}
        })
      })
    })

    const cfg = getChartSettings()

    const scm = { top: cfg.marginTop, bottom: cfg.marginBottom }
    chartsRef.current.forEach(c => {
      c.priceScale('right').applyOptions({ scaleMargins: scm })
      c.timeScale().applyOptions({ rightOffset: cfg.rightBars })
    })

    pChart.timeScale().setVisibleRange({ from: tradeTimeToTs(trade.date, '09:30'), to: tradeTimeToTs(trade.date, '16:00') })

    const makeWheelFn = (chart, el, marg) => (e) => {
      const rect = el.getBoundingClientRect()
      
      // Custom vertical scale adjustment only triggers if hovering the price scale
      if (e.clientX > rect.right - 65) {
        e.preventDefault()
        e.stopPropagation()
        const f = e.deltaY > 0 ? 1.06 : 1 / 1.06
        marg.t = Math.max(0.01, Math.min(0.48, marg.t * f))
        marg.b = Math.max(0.01, Math.min(0.48, marg.b * f))
        chart.priceScale('right').applyOptions({ scaleMargins: { top: marg.t, bottom: marg.b } })
      }
    }

    const paneEls = [priceEl, macdEl, rsiEl, optionEl] 
    let xhairSyncing = false
    chartsRef.current.forEach((src, si) => {
      src.subscribeCrosshairMove(params => {
        if (xhairSyncing) return
        xhairSyncing = true
        chartsRef.current.forEach((dst, di) => {
          if (di === si) return
          const dstEl = paneEls[di]?.current
          if (!dstEl) return
          if (params.time == null) {
            dstEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
          } else {
            const x = dst.timeScale().timeToCoordinate(params.time)
            if (x == null) return
            const r = dstEl.getBoundingClientRect()
            dstEl.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true, clientX: r.left + x, clientY: r.top + r.height / 2,
            }))
          }
        })
        xhairSyncing = false
      })
    })

    const pm = { t: cfg.marginTop, b: cfg.marginBottom }
    const mm = { t: cfg.marginTop, b: cfg.marginBottom }
    const rm = { t: cfg.marginTop, b: cfg.marginBottom }
    const om = { t: cfg.marginTop, b: cfg.marginBottom }
    const priceWheelFn  = makeWheelFn(pChart, priceEl.current, pm)
    const macdWheelFn   = showInds ? makeWheelFn(mChart, macdEl.current, mm) : null
    const rsiWheelFn    = showInds ? makeWheelFn(rChart, rsiEl.current,  rm) : null
    const optionWheelFn = oChart   ? makeWheelFn(oChart, optionEl.current, om) : null

    priceEl.current.addEventListener('wheel', priceWheelFn, { passive: false, capture: true })
    if (macdWheelFn)   macdEl.current.addEventListener('wheel', macdWheelFn,   { passive: false, capture: true })
    if (rsiWheelFn)    rsiEl.current.addEventListener('wheel', rsiWheelFn,     { passive: false, capture: true })
    if (optionWheelFn) optionEl.current.addEventListener('wheel', optionWheelFn, { passive: false, capture: true })

    return () => {
      priceEl.current?.removeEventListener('wheel', priceWheelFn, { capture: true })
      if (macdWheelFn)   macdEl.current?.removeEventListener('wheel', macdWheelFn,   { capture: true })
      if (rsiWheelFn)    rsiEl.current?.removeEventListener('wheel', rsiWheelFn,     { capture: true })
      if (optionWheelFn) optionEl.current?.removeEventListener('wheel', optionWheelFn, { capture: true })
      chartsRef.current.forEach(c => { try { c.remove() } catch {} })
      chartsRef.current = []; priceRef.current = null; oChartRef.current = null; vwapRef.current = null; maRefs.current = [null, null, null, null]
      setOhlcInfo(null)
      setOptionOhlcInfo(null)
    }
  }, [candles, optionCandles, isYahoo, trade]) 

  const handleUpload = async e => {
    const file = e.target.files[0]; if (!file) return; e.target.value = ''
    setUploading(true); setUploadError(null)
    try { await uploadChartCsv(file, trade.ticker); refetch() }
    catch (err) { setUploadError(err.message) }
    finally { setUploading(false) }
  }

  const handleRemoveTickerCsv = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return }
    setConfirmRemove(false)
    setRemovingTickerCsv(true)
    setUploadError(null)
    try {
      await deleteChartDay(trade.ticker, trade.date)
      // Invalidate both stored and Yahoo caches so chart shows empty state
      await qc.invalidateQueries({ queryKey: ['chart-data', trade.ticker, trade.date] })
      await qc.invalidateQueries({ queryKey: ['chart-yahoo', trade.ticker, trade.date] })
      refetch()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setRemovingTickerCsv(false)
    }
  }

  const handleSaveYahooDay = async () => {
    setSavingYahoo(true)
    setUploadError(null)
    try {
      await saveYahooDay(trade.ticker, trade.date)
      refetch()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setSavingYahoo(false)
    }
  }

  const handleOptionUpload = async e => {
    const file = e.target.files[0]; if (!file) return; e.target.value = ''
    setUploadingOption(true); setUploadError(null)
    try { await uploadChartCsv(file, optionTicker); refetchOption() }
    catch (err) { setUploadError(err.message) }
    finally { setUploadingOption(false) }
  }

  const handleRemoveOptionCsv = async () => {
    if (!confirmRemoveOption) { setConfirmRemoveOption(true); return }
    setConfirmRemoveOption(false)
    setRemovingOptionCsv(true)
    setUploadError(null)
    try {
      await deleteChartDay(optionTicker, trade.date)
      await qc.invalidateQueries({ queryKey: ['chart-data', optionTicker, trade.date] })
      refetchOption()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setRemovingOptionCsv(false)
    }
  }

  const toggle    = key => setCollapsed(c => ({ ...c, [key]: !c[key] }))
  const toggleInd = key => setInds(prev => ({ ...prev, [key]: !prev[key] }))
  const startResize = (pane) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const startY = e.clientY
    const startH = paneH[pane]
    const onMove = (mv) => setPaneH(prev => ({ ...prev, [pane]: Math.max(60, Math.min(400, startH + startY - mv.clientY)) }))
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }
  const MA_COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#f43f5e']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2"
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-col border border-border overflow-hidden w-full max-w-[98vw]"
        style={{ height: 'calc(100vh - 1rem)', background: BG }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <BarChart2 className="w-5 h-5 text-primary shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {trade.ticker} — {trade.date} {trade.time}{' '}
                <span className={trade.option_type === 'Call' ? 'text-blue-400' : 'text-purple-400'}>
                  {trade.option_type.toUpperCase()}
                </span>{' '}
                ${trade.strike} exp {trade.expiry}
              </h2>
              {isYahoo && hasData && (
                <p className="text-xs text-yellow-400 mt-0.5">Yahoo Finance data — upload a TradingView CSV for indicators</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex gap-0 bg-muted/50 p-0.5">
              {TF_OPTS.map((opt, i) => (
                <button key={opt.label} onClick={() => setTfIdx(i)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${tfIdx === i ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setEditOpen(o => !o)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border transition-colors ${
                editOpen ? 'bg-primary/20 text-primary border-primary/40' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 hover:bg-accent transition-colors border border-border">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading…' : 'Ticker CSV'}
              <input type="file" accept=".csv" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
            {confirmRemove ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-rose-400">Sure?</span>
                <button onClick={handleRemoveTickerCsv} disabled={removingTickerCsv}
                  className="text-xs font-bold px-2 py-1.5 border border-rose-500/60 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition-colors">
                  {removingTickerCsv ? 'Removing…' : 'Yes'}
                </button>
                <button onClick={() => setConfirmRemove(false)}
                  className="text-xs px-2 py-1.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={handleRemoveTickerCsv}
                disabled={isYahoo || removingTickerCsv}
                title={isYahoo ? 'No uploaded ticker CSV for this day' : 'Remove uploaded ticker CSV for this day'}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove Ticker CSV
              </button>
            )}
            <button
              onClick={handleSaveYahooDay}
              disabled={!isYahoo || savingYahoo}
              title={isYahoo ? 'Save fetched Yahoo candles for this day' : 'Stored CSV data is already available'}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            >
              <Upload className="w-3.5 h-3.5" />
              {savingYahoo ? 'Saving…' : 'Save Ticker Data'}
            </button>
            <label
              className="flex items-center gap-1.5 cursor-pointer text-xs px-2.5 py-1.5 transition-colors border"
              style={{
                color: hasOptionData ? '#22c55e' : 'hsl(var(--muted-foreground))',
                borderColor: hasOptionData ? '#22c55e44' : 'hsl(var(--border))',
                background: hasOptionData ? '#22c55e0a' : 'transparent',
              }}
            >
              <Upload className="w-3.5 h-3.5" />
              {uploadingOption ? 'Uploading…' : hasOptionData ? 'Option CSV ✓' : 'Option CSV'}
              <input type="file" accept=".csv" className="hidden" onChange={handleOptionUpload} disabled={uploadingOption} />
            </label>
            {hasOptionData && (
              <button
                onClick={handleRemoveOptionCsv}
                disabled={removingOptionCsv}
                title={confirmRemoveOption ? 'Click again to confirm deletion' : 'Delete option CSV data'}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  color: confirmRemoveOption ? '#ef4444' : 'hsl(var(--muted-foreground))',
                  borderColor: confirmRemoveOption ? '#ef444444' : 'hsl(var(--border))',
                  background: confirmRemoveOption ? '#ef44440a' : 'transparent',
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {removingOptionCsv ? 'Removing…' : confirmRemoveOption ? 'Confirm?' : 'Remove Option CSV'}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {uploadError && (
          <div className="mx-4 mt-2 flex items-center gap-2 border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 shrink-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {uploadError}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-hidden min-h-0 flex">
          {/* Chart */}
          <div className="flex-1 overflow-hidden min-w-0 flex flex-col">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                  <p className="text-sm">Loading chart data…</p>
                </div>
              </div>
            ) : !hasData ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center">
                  <BarChart2 className="mx-auto h-12 w-12 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">No chart data available</p>
                    <p className="mt-1 text-xs text-muted-foreground">Upload a TradingView CSV export for {trade.ticker} on {trade.date}</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
                    <Upload className="h-4 w-4" />
                    {uploading ? 'Uploading…' : 'Upload CSV'}
                    <input type="file" accept=".csv" className="hidden" onChange={handleUpload} disabled={uploading} />
                  </label>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full">
                {/* Price + Option proportional section — option is 2/3 the height of price (3:2 ratio) */}
                <div className="flex flex-col min-h-0" style={{ flex: '1 1 auto' }}>
                  <div className="relative min-h-0" style={{ flex: 3, position: 'relative' }}>
                    <div ref={priceEl} className="absolute inset-0" />

                    {/* OHLC info overlay — left */}
                    {ohlcInfo && (
                      <div className="absolute top-1.5 left-2 z-20 flex items-center gap-2.5 font-mono text-[11px] pointer-events-none select-none" style={{ color: 'rgba(255,255,255,0.38)' }}>
                        <span>O <span style={{ color: 'rgba(255,255,255,0.78)' }}>{ohlcInfo.open.toFixed(2)}</span></span>
                        <span>H <span style={{ color: '#4ade80' }}>{ohlcInfo.high.toFixed(2)}</span></span>
                        <span>L <span style={{ color: '#f87171' }}>{ohlcInfo.low.toFixed(2)}</span></span>
                        <span>C <span style={{ color: ohlcInfo.close >= ohlcInfo.open ? '#4ade80' : '#f87171' }}>{ohlcInfo.close.toFixed(2)}</span></span>
                      </div>
                    )}

                    {/* Fit / Log buttons — right */}
                    <div className="absolute top-1.5 right-1.5 flex gap-0.5 z-20">
                      <ChartOverlayBtn active={fitPrice} onClick={() => { const v = !fitPrice; setFitPrice(v); if (v) chartsRef.current.forEach(c => c.timeScale().fitContent()) }}>Fit</ChartOverlayBtn>
                      <ChartOverlayBtn active={logScale} onClick={() => setLogScale(l => !l)}>Log</ChartOverlayBtn>
                    </div>
                  </div>
                  {/* Option price pane — proportional flex, collapses to header only */}
                  {hasOptionData ? (
                    <div style={{
                      flex: collapsed.option ? '0 0 28px' : 2,
                      overflow: 'hidden',
                      minHeight: 0,
                      borderTop: `1px solid ${BORD}`,
                    }}>
                      <PaneHeader label={`Option · ${trade.ticker} ${trade.option_type[0]} $${trade.strike} exp ${trade.expiry}`} collapsed={collapsed.option} onToggle={() => toggle('option')} />
                      <div className="relative" style={{ height: 'calc(100% - 28px)' }}>
                        <div ref={optionEl} className="absolute inset-0" />
                        {optionOhlcInfo && !collapsed.option && (
                          <div className="absolute top-1.5 left-2 z-10 flex items-center gap-2.5 font-mono text-[11px] pointer-events-none select-none" style={{ color: 'rgba(255,255,255,0.38)' }}>
                            <span>O <span style={{ color: 'rgba(255,255,255,0.78)' }}>{optionOhlcInfo.open.toFixed(2)}</span></span>
                            <span>H <span style={{ color: '#4ade80' }}>{optionOhlcInfo.high.toFixed(2)}</span></span>
                            <span>L <span style={{ color: '#f87171' }}>{optionOhlcInfo.low.toFixed(2)}</span></span>
                            <span>C <span style={{ color: optionOhlcInfo.close >= optionOhlcInfo.open ? '#4ade80' : '#f87171' }}>{optionOhlcInfo.close.toFixed(2)}</span></span>
                          </div>
                        )}
                        {!collapsed.option && (
                          <div className="absolute top-1.5 right-1.5 flex gap-0.5 z-10">
                            <ChartOverlayBtn active={fitOption} onClick={() => { const v = !fitOption; setFitOption(v); if (v) oChartRef.current?.timeScale().fitContent() }}>Fit</ChartOverlayBtn>
                            <ChartOverlayBtn active={logOption} onClick={() => setLogOption(l => !l)}>Log</ChartOverlayBtn>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div ref={optionEl} style={{ height: 0, overflow: 'hidden', flexShrink: 0 }} />
                  )}
                </div>

                {showInds && (
                  <>
                    <div style={{ height: 4, flexShrink: 0, cursor: 'ns-resize' }} className="hover:bg-white/10 transition-colors" onMouseDown={startResize('macd')} />
                    <div style={{ flexShrink: 0, overflow: 'hidden', height: collapsed.macd ? 28 : paneH.macd + 28, transition: collapsed.macd ? 'height 150ms ease' : 'none' }}>
                      <PaneHeader label="MACD" collapsed={collapsed.macd} onToggle={() => toggle('macd')} />
                      <div className="relative" style={{ height: paneH.macd }}>
                        <div ref={macdEl} className="absolute inset-0" />
                        {!collapsed.macd && <div className="absolute top-1.5 right-1.5 flex gap-0.5 z-10"><ChartOverlayBtn active={fitMacd} onClick={() => { const v = !fitMacd; setFitMacd(v); if (v) chartsRef.current[1]?.timeScale().fitContent() }}>Fit</ChartOverlayBtn><ChartOverlayBtn active={logMacd} onClick={() => setLogMacd(l => !l)}>Log</ChartOverlayBtn></div>}
                      </div>
                    </div>
                    <div style={{ height: 4, flexShrink: 0, cursor: 'ns-resize' }} className="hover:bg-white/10 transition-colors" onMouseDown={startResize('rsi')} />
                    <div style={{ flexShrink: 0, overflow: 'hidden', height: collapsed.rsi ? 28 : paneH.rsi + 28, transition: collapsed.rsi ? 'height 150ms ease' : 'none' }}>
                      <PaneHeader label="RSI" collapsed={collapsed.rsi} onToggle={() => toggle('rsi')} />
                      <div className="relative" style={{ height: paneH.rsi }}>
                        <div ref={rsiEl} className="absolute inset-0" />
                        {!collapsed.rsi && <div className="absolute top-1.5 right-1.5 flex gap-0.5 z-10"><ChartOverlayBtn active={fitRsi} onClick={() => { const v = !fitRsi; setFitRsi(v); if (v) chartsRef.current[2]?.timeScale().fitContent() }}>Fit</ChartOverlayBtn><ChartOverlayBtn active={logRsi} onClick={() => setLogRsi(l => !l)}>Log</ChartOverlayBtn></div>}
                      </div>
                    </div>
                  </>
                )}
                {!showInds && (
                  <>
                    <div ref={macdEl} style={{ height: 0, overflow: 'hidden' }} />
                    <div ref={rsiEl}  style={{ height: 0, overflow: 'hidden' }} />
                  </>
                )}
              </div>
            )}

            {/* Legend */}
            {hasData && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground shrink-0">
                {!isYahoo && (
                  <>
                    <IndToggle active={inds.vwap} color="#06b6d4" label="VWAP" onToggle={() => toggleInd('vwap')} />
                    {MA_COLORS.map((col, i) => (
                      <IndToggle key={i} active={inds[`ma${i+1}`]} color={col} label={`MA${i+1}`} onToggle={() => toggleInd(`ma${i+1}`)} />
                    ))}
                    <span className="w-px h-3 bg-border mx-1" />
                  </>
                )}
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-green-500" />Entry</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />Exit</span>
              </div>
            )}
          </div>

          {/* Notes sidebar */}
          {!editOpen && (
            <NotesPanel trade={trade} onRefresh={() => qc.invalidateQueries({ queryKey: ['trades'] })} />
          )}

          {/* Edit panel */}
          {editOpen && (
            <div style={{ width: 300, flexShrink: 0 }}>
              <EditPanel
                trade={trade}
                onRefresh={() => qc.invalidateQueries({ queryKey: ['trades'] })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}