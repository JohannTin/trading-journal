import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTrades, deleteTrade, deleteExit, updateTrade, getDeletedTrades, restoreTrade, permanentDeleteTrade } from '../api'
import { useAccount } from '../AccountContext'
import { getAppSettings } from '../appSettings'
import TradeModal from './TradeModal'
import TradeChart from './TradeChart'
import { Plus, Trash2, PlusCircle, Pencil, BarChart2, LayoutList, Table2, ChevronDown, ChevronRight, X, Tag, StickyNote, CheckSquare, Flag, RotateCcw } from 'lucide-react'
import { CARD, BADGE_CALL, BADGE_PUT, BTN_PRIMARY, BTN_ICON, BTN_DANGER, pnlColor, fmt } from '../styles'

const STATUS_FILTERS = ['All', 'Open', 'Closed', 'Winners', 'Losers']
const DATE_RANGES    = ['All time', 'Today', 'This week', 'This month', 'Custom']

const SORT_OPTS = [
  { id: 'date-desc',  label: 'NEWEST' },
  { id: 'date-asc',   label: 'OLDEST' },
]

function isoToday() { return new Date().toISOString().slice(0, 10) }
function isoWeekStart() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}
function isoMonthStart() {
  const d = new Date(); d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function hasMacd(v) { return typeof v === 'number' && Number.isFinite(v) }
function fmtMacd(v) { return hasMacd(v) ? v.toFixed(2) : '—' }

function parseTradeNotes(value) {
  const text = (value ?? '').replace(/\r/g, '')
  const lines = text.split('\n')
  const sections = { entry: '', notes: '' }
  let current = null

  for (const line of lines) {
    const normalized = line.trim().toLowerCase()
    if (normalized === 'entry:') { current = 'entry'; continue }
    if (normalized === 'notes:') { current = 'notes'; continue }
    const m = normalized.match(/^exit\s+(\d+):$/)
    if (m) { current = `exit${m[1]}`; if (!(current in sections)) sections[current] = ''; continue }
    // legacy single Exit: header
    if (normalized === 'exit:') { current = 'exit1'; if (!sections.exit1) sections.exit1 = ''; continue }
    if (current != null) sections[current] = sections[current] ? `${sections[current]}\n${line}` : line
  }

  if (!sections.entry && !sections.notes && !Object.keys(sections).some(k => k.startsWith('exit') && sections[k]) && text.trim()) {
    sections.notes = text.trim()
  }

  for (const k of Object.keys(sections)) sections[k] = (sections[k] ?? '').trim()
  return sections
}

function NotesBlock({ notes, exits = [] }) {
  const [open, setOpen] = useState(false)
  const sections = parseTradeNotes(notes)

  const general = sections.notes
  const exitSections = Object.keys(sections)
    .map(k => {
      const m = k.match(/^exit(\d+)$/)
      return m ? Number(m[1]) : null
    })
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map(n => {
      const text = sections[`exit${n}`] ?? ''
      if (!text) return null
      const exit = exits[n - 1] ?? null
      return { n, exit, text }
    })
    .filter(Boolean)

  const hasDetail = Boolean(sections.entry) || exitSections.length > 0
  const hasAny = general || hasDetail
  if (!hasAny) return null

  return (
    <div className="text-xs text-muted-foreground border-t border-border pt-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {general && <p className="italic whitespace-pre-wrap leading-relaxed">{general}</p>}
        </div>
        {hasDetail && (
          <button
            onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors shrink-0"
          >
            <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            {open ? 'Hide entry/exits' : 'Show entry/exits'}
          </button>
        )}
      </div>
      {hasDetail && open && (
        <div className="space-y-2 pl-2 border-l border-border/40">
          {sections.entry && (
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Entry</span>
              <p className="whitespace-pre-wrap leading-relaxed">{sections.entry}</p>
            </div>
          )}
          {exitSections.map(({ exit: ex, n, text }) => (
            <div key={`exit${n}`} className="space-y-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                Exit {n}{' '}
                {ex
                  ? <span className="font-normal normal-case tracking-normal text-muted-foreground/40">· {ex.time} · ${ex.price.toFixed(2)}</span>
                  : null}
              </span>
              <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Ticker / Strategy autocomplete ────────────────────────────────────────────
function TickerAutocomplete({ value, onChange, tickers, uppercase = true, placeholder = 'Ticker…' }) {
  const [input,  setInput] = useState(value)
  const [open,   setOpen]  = useState(false)
  const [hiIdx,  setHiIdx] = useState(0)
  const ref = useRef(null)

  useEffect(() => { if (!value) setInput('') }, [value])

  const suggestions = useMemo(() => {
    if (!input) return []
    return tickers.filter(t => t.toLowerCase().startsWith(input.toLowerCase())).slice(0, 8)
  }, [input, tickers])

  const commit = t => { setInput(t); onChange(t); setOpen(false) }

  const handleKey = e => {
    if (!open || !suggestions.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHiIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHiIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); commit(suggestions[hiIdx]) }
    if (e.key === 'Escape')    { setOpen(false) }
  }

  useEffect(() => {
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input type="text" value={input} placeholder={placeholder}
        className={`border border-border bg-card text-xs px-2 py-1.5 text-foreground focus:outline-none focus:border-primary/50 w-24 placeholder:text-muted-foreground ${uppercase ? 'uppercase placeholder:normal-case' : ''}`}
        onChange={e => { const v = uppercase ? e.target.value.toUpperCase() : e.target.value; setInput(v); setHiIdx(0); setOpen(true); if (!v) onChange('') }}
        onFocus={() => input && setOpen(true)}
        onKeyDown={handleKey}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 mt-0.5 z-50 border border-border bg-card shadow-lg min-w-[6rem]">
          {suggestions.map((t, i) => (
            <button key={t} onMouseDown={e => { e.preventDefault(); commit(t) }}
              className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors ${i === hiIdx ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-accent'}`}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Exit pill ──────────────────────────────────────────────────────────────────
function ExitPill({ exit, onEdit, onDelete }) {
  const pos = exit.pnl >= 0
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-medium ${pos ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-500'}`}>
      <span className="font-mono">{exit.qty}×@${exit.price.toFixed(2)}</span>
      <span className="opacity-60 font-mono">{fmt(exit.pnl)} ({exit.pct >= 0 ? '+' : ''}{exit.pct.toFixed(0)}%)</span>
      <span className="opacity-60 font-mono">H:{fmtMacd(exit.macd_hist)}</span>
      <span className="inline-flex items-center gap-0.5 ml-0.5 pl-1 border-l border-current/20">
        <button onClick={e => { e.stopPropagation(); onEdit(exit) }} className="opacity-40 hover:opacity-100 transition-opacity"><Pencil className="w-3 h-3" /></button>
        <button onClick={e => { e.stopPropagation(); onDelete(exit.id) }} className="opacity-40 hover:opacity-100 transition-opacity"><Trash2 className="w-3 h-3" /></button>
      </span>
    </span>
  )
}

// ── MAE / MFE bar ──────────────────────────────────────────────────────────────
function MaeMfeBar({ exits }) {
  const withData = exits.filter(e => e.mae != null && e.mfe != null)
  if (!withData.length) return null

  // Use the last exit (full hold period) for the primary display
  const last = withData[withData.length - 1]
  const { mae, mfe, post_exit_mfe } = last

  return (
    <div className="flex items-center gap-3 text-[10px] font-mono border-t border-border/50 pt-1.5 mt-0.5">
      <span className="text-muted-foreground uppercase tracking-wider font-bold">MAE/MFE</span>
      <span className={`${mae < 0 ? 'text-rose-400' : 'text-muted-foreground'}`}>
        MAE {mae >= 0 ? '+' : ''}{mae.toFixed(1)}%
      </span>
      <span className={mfe >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
        MFE {mfe >= 0 ? '+' : ''}{mfe.toFixed(1)}%
      </span>
      {post_exit_mfe != null && (
        <span className={`${post_exit_mfe > mfe ? 'text-amber-400' : 'text-muted-foreground/60'}`} title="Best price after your exit">
          Post-exit {post_exit_mfe >= 0 ? '+' : ''}{post_exit_mfe.toFixed(1)}%
          {post_exit_mfe > mfe && ' ↑'}
        </span>
      )}
    </div>
  )
}

// ── Detailed card ──────────────────────────────────────────────────────────────
function TradeCard({ trade, selected, onSelect, selectionMode, onAddExit, onEditExit, onDelete, onEdit, onChart, onFlag }) {
  const exited   = trade.exits.reduce((s, e) => s + e.qty, 0)
  const remaining = trade.qty - exited
  const progress  = exited / trade.qty
  const qc = useQueryClient()

  const threshold = getAppSettings().processWinThreshold ?? 30
  const lastExit  = trade.exits.filter(e => e.mfe != null).at(-1) ?? null
  const lastMfe   = lastExit?.mfe ?? null
  const lastMae   = lastExit?.mae ?? null
  const goodSetup = trade.status === 'closed' && trade.total_pnl <= 0 && lastMfe != null && lastMfe >= threshold

  const delExitMut = useMutation({
    mutationFn: deleteExit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['stats-overview'] })
      qc.invalidateQueries({ queryKey: ['stats-calendar'] })
    },
  })

  const accentColor = trade.status === 'open' ? 'border-l-amber-400' : trade.total_pnl > 0 ? 'border-l-emerald-400' : 'border-l-rose-500'

  return (
    <div onClick={() => onChart(trade)} className={`border border-border border-l-2 ${accentColor} bg-card p-4 space-y-3 hover:bg-muted/10 transition-colors cursor-pointer ${selected ? 'ring-1 ring-primary/40 bg-primary/5' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {selectionMode && (
            <input type="checkbox" checked={selected} onChange={() => onSelect(trade.id)}
              onClick={e => e.stopPropagation()}
              className="w-3.5 h-3.5 accent-primary shrink-0 cursor-pointer" />
          )}
          <span className={trade.option_type === 'Call' ? BADGE_CALL : BADGE_PUT}>{trade.option_type.toUpperCase()}</span>
          <span className="font-bold text-foreground text-sm">{trade.ticker} ${trade.strike}</span>
          <span className="text-xs text-muted-foreground">exp {trade.expiry}</span>
          {trade.strategy && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5">{trade.strategy}</span>}
          {trade.source   && <span className="text-xs bg-accent text-muted-foreground px-2 py-0.5">{trade.source}</span>}
          {lastMfe != null && (
            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 border ${
              goodSetup
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-muted/30 text-muted-foreground border-border'
            }`}>
              {goodSetup && 'Good Setup · '}
              {`MFE ${lastMfe >= 0 ? '+' : ''}${lastMfe.toFixed(1)}%`}
              {lastMae != null && ` MAE ${lastMae.toFixed(1)}%`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={() => onFlag(trade)} title={trade.flagged ? 'Remove flag' : 'Flag for review'}
            className={`p-1.5 transition-colors ${trade.flagged ? 'text-amber-400 hover:text-amber-300' : `${BTN_ICON}`}`}>
            <Flag className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onEdit(trade)}  className={`${BTN_ICON} flex items-center`} title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
          {remaining > 0 && (
            <button onClick={() => onAddExit(trade)} className="flex items-center gap-1 text-xs text-primary font-semibold px-2 py-1 hover:bg-primary/10 transition-colors">
              <PlusCircle className="w-3.5 h-3.5" /> Exit
            </button>
          )}
          <button onClick={() => onDelete(trade.id)} className={`${BTN_DANGER} p-1.5`}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="font-mono">{trade.date} {trade.time}</span>
        <span>Fill: <span className="font-mono text-foreground">${trade.fill}</span></span>
        <span>Qty: <span className="font-mono text-foreground">{trade.qty}</span></span>
        <span>Cost: <span className="font-mono text-foreground">${trade.total_cost.toFixed(2)}</span></span>
        <span>Entry MACD H: <span className="font-mono text-foreground">{fmtMacd(trade.entry_macd_hist)}</span></span>
        <span className={`font-bold text-[10px] tracking-widest uppercase ${trade.status === 'open' ? 'text-amber-400' : 'text-muted-foreground'}`}>{trade.status}</span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="font-mono">{exited}/{trade.qty} contracts exited</span>
          {remaining > 0 && <span className="text-amber-400 font-mono">{remaining} remaining</span>}
        </div>
        <div className="h-0.5 bg-muted overflow-hidden">
          <div className={`h-full transition-all ${trade.status === 'open' ? 'bg-amber-400' : trade.total_pnl >= 0 ? 'bg-emerald-400' : 'bg-rose-500'}`} style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      {trade.exits.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {trade.exits.map(e => (
            <ExitPill key={e.id} exit={e} onEdit={exit => onEditExit(trade, exit)} onDelete={id => window.confirm('Delete this exit?') && delExitMut.mutate(id)} />
          ))}
        </div>
      )}
      <MaeMfeBar exits={trade.exits} />
      {trade.total_pnl !== 0 && <div className={`font-mono text-sm font-semibold ${pnlColor(trade.total_pnl)}`}>{fmt(trade.total_pnl)}</div>}
      <NotesBlock notes={trade.notes} exits={trade.exits} />
    </div>
  )
}

// ── Compact row (expandable) ───────────────────────────────────────────────────
function TradeRow({ trade, selected, onSelect, selectionMode, onAddExit, onEditExit, onDelete, onEdit, onChart, onFlag }) {
  const [expanded, setExpanded] = useState(false)
  const exited    = trade.exits.reduce((s, e) => s + e.qty, 0)
  const remaining = trade.qty - exited
  const progress  = exited / trade.qty

  const threshold = getAppSettings().processWinThreshold ?? 30
  const lastExit  = trade.exits.filter(e => e.mfe != null).at(-1) ?? null
  const lastMfe   = lastExit?.mfe ?? null
  const lastMae   = lastExit?.mae ?? null
  const goodSetup = trade.status === 'closed' && trade.total_pnl <= 0 && lastMfe != null && lastMfe >= threshold
  const parsedNotes = parseTradeNotes(trade.notes)
  const exitPreviewKey = Object.keys(parsedNotes)
    .filter(k => /^exit\d+$/.test(k) && parsedNotes[k])
    .sort((a, b) => parseInt(a.slice(4), 10) - parseInt(b.slice(4), 10))[0]
  const notePreview = parsedNotes.notes || parsedNotes.entry || (exitPreviewKey ? parsedNotes[exitPreviewKey] : '')
  const qc = useQueryClient()

  const delExitMut = useMutation({
    mutationFn: deleteExit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['stats-overview'] })
      qc.invalidateQueries({ queryKey: ['stats-calendar'] })
    },
  })

  const accentColor = trade.status === 'open' ? 'border-l-amber-400' : trade.total_pnl > 0 ? 'border-l-emerald-400' : 'border-l-rose-500'

  return (
    <div className={`border border-border border-l-2 ${accentColor} bg-card ${selected ? 'ring-1 ring-primary/40 bg-primary/5' : ''}`}>
      {/* Main row */}
      <div
        className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/10 transition-colors cursor-pointer"
        onClick={() => onChart(trade)}
      >
        {selectionMode && (
          <input type="checkbox" checked={selected} onChange={() => onSelect(trade.id)}
            onClick={e => e.stopPropagation()}
            className="w-3.5 h-3.5 accent-primary shrink-0 cursor-pointer" />
        )}
        <ChevronRight onClick={e => { e.stopPropagation(); setExpanded(v => !v) }} className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform cursor-pointer hover:text-foreground ${expanded ? 'rotate-90' : ''}`} />
        <span className={`shrink-0 ${trade.option_type === 'Call' ? BADGE_CALL : BADGE_PUT}`}>{trade.option_type[0]}</span>
        <span className="font-bold text-sm text-foreground w-28 truncate shrink-0">{trade.ticker} <span className="text-muted-foreground font-mono text-xs">${trade.strike}</span></span>
        <span className="text-xs text-muted-foreground font-mono w-20 shrink-0">{trade.expiry}</span>
        <span className="text-xs text-muted-foreground font-mono w-24 shrink-0">{trade.date}</span>
        <span className="text-xs text-muted-foreground font-mono w-20 shrink-0">{trade.qty}× @${trade.fill}</span>
        <span className="text-xs text-muted-foreground w-20 truncate shrink-0">{trade.strategy ?? '—'}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest shrink-0 w-12 ${trade.status === 'open' ? 'text-amber-400' : 'text-muted-foreground'}`}>{trade.status}</span>

        {/* Notes indicator */}
        {notePreview && (
          <div className="relative group shrink-0">
            <StickyNote className="w-3 h-3 text-muted-foreground/50" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 bg-card border border-border px-2.5 py-2 text-xs text-muted-foreground shadow-lg hidden group-hover:block z-50 pointer-events-none">
              {notePreview}
            </div>
          </div>
        )}

        {lastMfe != null && (
          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 border shrink-0 ${
            goodSetup
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-muted/30 text-muted-foreground border-border'
          }`}>
            {goodSetup && 'Good Setup · '}
            {`MFE ${lastMfe >= 0 ? '+' : ''}${lastMfe.toFixed(1)}%`}
            {lastMae != null && ` MAE ${lastMae.toFixed(1)}%`}
          </span>
        )}

        <span className={`font-mono text-sm font-semibold ml-auto shrink-0 ${trade.total_pnl !== 0 ? pnlColor(trade.total_pnl) : 'text-muted-foreground'}`}>
          {trade.total_pnl !== 0 ? fmt(trade.total_pnl) : '—'}
        </span>
        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={() => onFlag(trade)} title={trade.flagged ? 'Remove flag' : 'Flag for review'}
            className={`p-1.5 transition-colors ${trade.flagged ? 'text-amber-400 hover:text-amber-300' : `${BTN_ICON}`}`}>
            <Flag className="w-3 h-3" />
          </button>
          <button onClick={() => onChart(trade)} className={`${BTN_ICON} flex items-center`} title="Chart"><BarChart2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => onEdit(trade)}  className={`${BTN_ICON} flex items-center`} title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
          {remaining > 0 && (
            <button onClick={() => onAddExit(trade)} className="flex items-center gap-1 text-xs text-primary font-semibold px-2 py-1 hover:bg-primary/10 transition-colors">
              <PlusCircle className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => onDelete(trade.id)} className={`${BTN_DANGER} p-1.5`}><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-10 pb-3 pt-1 space-y-2 border-t border-border bg-muted/5">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="font-mono">{exited}/{trade.qty} contracts exited</span>
              {remaining > 0 && <span className="text-amber-400 font-mono">{remaining} remaining</span>}
            </div>
            <div className="h-0.5 bg-muted overflow-hidden">
              <div className={`h-full ${trade.status === 'open' ? 'bg-amber-400' : trade.total_pnl >= 0 ? 'bg-emerald-400' : 'bg-rose-500'}`} style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
          {trade.exits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {trade.exits.map(e => (
                <ExitPill key={e.id} exit={e} onEdit={exit => onEditExit(trade, exit)} onDelete={id => window.confirm('Delete this exit?') && delExitMut.mutate(id)} />
              ))}
            </div>
          )}
          <MaeMfeBar exits={trade.exits} />
          <div className="text-xs text-muted-foreground font-mono">
            Entry MACD {fmtMacd(trade.entry_macd)} / Signal {fmtMacd(trade.entry_macd_signal)} / Hist {fmtMacd(trade.entry_macd_hist)}
          </div>
          <NotesBlock notes={trade.notes} exits={trade.exits} />
        </div>
      )}
    </div>
  )
}

// ── Summary bar ────────────────────────────────────────────────────────────────
function SummaryBar({ trades }) {
  const closed  = trades.filter(t => t.status === 'closed')
  const wins    = closed.filter(t => t.total_pnl > 0)
  const losses  = closed.filter(t => t.total_pnl <= 0)
  const total   = closed.reduce((s, t) => s + t.total_pnl, 0)
  const winRate = closed.length > 0 ? wins.length / closed.length * 100 : 0
  const avgWin  = wins.length   ? wins.reduce((s, t)   => s + t.total_pnl, 0) / wins.length   : 0
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.total_pnl, 0) / losses.length : 0

  const Cell = ({ label, value, color = 'text-foreground' }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  )

  return (
    <div className="flex items-center gap-6 border border-border bg-card px-4 py-2.5 flex-wrap">
      <Cell label="Showing"   value={`${trades.length} trades`} />
      <div className="w-px h-6 bg-border" />
      <Cell label="Total P&L" value={closed.length ? fmt(total) : '—'} color={closed.length ? pnlColor(total) : 'text-muted-foreground'} />
      <Cell label="Win Rate"  value={closed.length ? `${winRate.toFixed(1)}%` : '—'} color={winRate >= 50 ? 'text-emerald-400' : closed.length ? 'text-rose-500' : 'text-muted-foreground'} />
      <Cell label="Avg Win"   value={avgWin  ? fmt(avgWin)  : '—'} color="text-emerald-400" />
      <Cell label="Avg Loss"  value={avgLoss ? fmt(avgLoss) : '—'} color="text-rose-500" />
      <Cell label="Open"      value={trades.filter(t => t.status === 'open').length} />
    </div>
  )
}

// ── Bulk action bar ────────────────────────────────────────────────────────────
function BulkBar({ count, onDelete, onTag, onClear }) {
  const [tagInput, setTagInput] = useState('')
  const [tagging,  setTagging]  = useState(false)

  return (
    <div className="flex items-center gap-3 border border-primary/40 bg-primary/5 px-4 py-2.5">
      <span className="text-xs font-bold text-primary">{count} selected</span>
      <div className="w-px h-4 bg-border" />

      {/* Tag */}
      {tagging ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && tagInput) { onTag(tagInput); setTagging(false); setTagInput('') } if (e.key === 'Escape') setTagging(false) }}
            placeholder="Strategy name…"
            className="border border-border bg-card text-xs px-2 py-1 text-foreground focus:outline-none focus:border-primary/50 w-36 placeholder:text-muted-foreground"
          />
          <button
            onClick={() => { if (tagInput) { onTag(tagInput); setTagging(false); setTagInput('') } }}
            className="text-xs font-semibold px-2 py-1 bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >Apply</button>
          <button onClick={() => setTagging(false)} className="text-xs text-muted-foreground hover:text-foreground px-1">✕</button>
        </div>
      ) : (
        <button onClick={() => setTagging(true)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border px-2.5 py-1 hover:bg-accent transition-colors">
          <Tag className="w-3 h-3" /> Tag strategy
        </button>
      )}

      <button onClick={onDelete} className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 border border-rose-500/30 px-2.5 py-1 hover:bg-rose-500/10 transition-colors">
        <Trash2 className="w-3 h-3" /> Delete selected
      </button>

      <button onClick={onClear} className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
        <X className="w-3 h-3" /> Clear selection
      </button>
    </div>
  )
}

// ── Date group ─────────────────────────────────────────────────────────────────
function DateGroup({ date, trades, compact, selected, onSelect, selectionMode, ...actions }) {
  const [open, setOpen] = useState(true)
  const groupPnl = trades.filter(t => t.status === 'closed').reduce((s, t) => s + t.total_pnl, 0)
  const hasAny   = trades.some(t => t.status === 'closed')
  const allSelected = trades.every(t => selected.has(t.id))

  return (
    <div>
      <div className="flex items-center gap-2 py-1.5">
        {selectionMode && (
          <input type="checkbox" checked={allSelected} onChange={() => trades.forEach(t => onSelect(t.id, !allSelected))}
            className="w-3.5 h-3.5 accent-primary cursor-pointer" />
        )}
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
          <span className="text-xs font-bold text-muted-foreground">{date}</span>
          <span className="text-xs text-muted-foreground">· {trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
          {hasAny && <span className={`text-xs font-mono font-semibold ml-1 ${pnlColor(groupPnl)}`}>{fmt(groupPnl)}</span>}
        </button>
      </div>
      {open && (
        <div className={compact ? 'space-y-px' : 'space-y-2'}>
          {trades.map(t =>
            compact
              ? <TradeRow  key={t.id} trade={t} selected={selected.has(t.id)} onSelect={id => onSelect(id)} selectionMode={selectionMode} {...actions} />
              : <TradeCard key={t.id} trade={t} selected={selected.has(t.id)} onSelect={id => onSelect(id)} selectionMode={selectionMode} {...actions} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Trash Bin Modal ────────────────────────────────────────────────────────────

function TrashBin({ accountId, onClose }) {
  const qc = useQueryClient()

  const { data: deleted = [], isLoading } = useQuery({
    queryKey: ['trades-deleted', accountId],
    queryFn: () => getDeletedTrades(accountId),
  })

  const restoreMutation = useMutation({
    mutationFn: restoreTrade,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['trades-deleted'] })
      qc.invalidateQueries({ queryKey: ['stats-overview'] })
      qc.invalidateQueries({ queryKey: ['stats-calendar'] })
    },
  })

  const permDeleteMutation = useMutation({
    mutationFn: permanentDeleteTrade,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trades-deleted'] }),
  })

  const dollar = (v) => {
    const abs = Math.abs(v ?? 0).toFixed(2)
    return (v ?? 0) >= 0 ? `+$${abs}` : `-$${abs}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-bold text-foreground">Trash</p>
            {deleted.length > 0 && (
              <span className="text-[10px] font-bold text-muted-foreground bg-muted/40 px-2 py-0.5">
                {deleted.length}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {isLoading ? (
            <p className="text-xs text-muted-foreground/50 text-center py-8">Loading…</p>
          ) : deleted.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 text-center py-8">Trash is empty</p>
          ) : deleted.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3 border border-border bg-muted/10 hover:bg-accent/30 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-bold text-foreground">{t.ticker}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 font-bold ${t.option_type === 'Call' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'}`}>
                    {t.option_type === 'Call' ? 'C' : 'P'} {t.strike}
                  </span>
                  {t.strategy && (
                    <span className="text-[10px] text-muted-foreground/60">{t.strategy}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{t.date}</span>
                  <span>{t.qty} × ${t.fill}</span>
                  <span className={t.total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {dollar(t.total_pnl)}
                  </span>
                  <span className="ml-auto text-muted-foreground/40">
                    deleted {new Date(t.deleted_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => restoreMutation.mutate(t.id)}
                disabled={restoreMutation.isPending}
                title="Restore trade"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              >
                <RotateCcw className="w-3 h-3" /> Restore
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Permanently delete this trade? This cannot be undone.'))
                    permDeleteMutation.mutate(t.id)
                }}
                disabled={permDeleteMutation.isPending}
                title="Delete permanently"
                className="p-1.5 text-muted-foreground/40 hover:text-rose-400 transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        {deleted.length > 0 && (
          <div className="shrink-0 border-t border-border px-5 py-3 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground/50">Restore individual trades or delete them permanently.</p>
            <button
              onClick={() => {
                if (window.confirm(`Permanently delete all ${deleted.length} trade${deleted.length !== 1 ? 's' : ''} in the trash?`))
                  deleted.forEach(t => permDeleteMutation.mutate(t.id))
              }}
              className="text-[10px] font-bold uppercase tracking-wider text-rose-400/70 hover:text-rose-400 transition-colors"
            >
              Empty Trash
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TradeLog() {
  const qc = useQueryClient()
  const { accountId } = useAccount()
  const sessionEnd = getAppSettings().tradingEnd

  const [statusFilter, setStatusFilter] = useState('All')
  const [tickerFilter, setTickerFilter] = useState('')
  const [typeFilter,   setTypeFilter]   = useState('All')
  const [stratFilter,  setStratFilter]  = useState('')
  const [flagFilter,   setFlagFilter]   = useState(false)
  const [dateRange,    setDateRange]    = useState('All time')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [sortBy,       setSortBy]       = useState('date-desc')
  const [groupByDate,  setGroupByDate]  = useState(true)
  const [compact,      setCompact]      = useState(false)
  const [selected,     setSelected]     = useState(new Set())
  const [selectionMode,setSelectionMode]= useState(false)

  const [modal,         setModal]         = useState(null)
  const [chartTrade,    setChartTrade]    = useState(null)
  const [chartEditOpen, setChartEditOpen] = useState(false)
  const [binOpen,       setBinOpen]       = useState(false)

  const apiStatus = statusFilter === 'Open' ? 'open' : statusFilter === 'Closed' ? 'closed' : undefined

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['trades', apiStatus, accountId, sessionEnd],
    queryFn:  () => getTrades(apiStatus, accountId, sessionEnd),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTrade,
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['stats-overview'] })
      qc.invalidateQueries({ queryKey: ['stats-calendar'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateTrade(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trades'] }),
  })

  const toggleFlag = useCallback((trade) => {
    updateMutation.mutate({ id: trade.id, payload: { flagged: !trade.flagged } })
  }, [updateMutation])

  // Keyboard shortcut: N = new trade (skip if focused on input)
  useEffect(() => {
    const h = e => {
      if (e.key === 'n' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault()
        setModal({ mode: 'trade', defaultTicker: lastTicker })
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const tickers    = useMemo(() => [...new Set(trades.map(t => t.ticker))].sort(),           [trades])
  const strategies = useMemo(() => [...new Set(trades.map(t => t.strategy).filter(Boolean))].sort(), [trades])

  const lastTicker = useMemo(() => {
    if (!trades.length) return 'SPY'
    const today = isoToday()
    const todayTrades = trades.filter(t => t.date === today)
    const pool = todayTrades.length ? todayTrades : trades
    return [...pool].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))[0].ticker
  }, [trades])

  // Date range cutoff
  const dateFrom_ = useMemo(() => {
    if (dateRange === 'Today')      return isoToday()
    if (dateRange === 'This week')  return isoWeekStart()
    if (dateRange === 'This month') return isoMonthStart()
    if (dateRange === 'Custom')     return dateFrom
    return ''
  }, [dateRange, dateFrom])

  const dateTo_ = dateRange === 'Custom' ? dateTo : dateRange === 'Today' ? isoToday() : ''

  const displayed = useMemo(() => {
    let list = trades.filter(t => {
      if (statusFilter === 'Winners') return t.total_pnl > 0  && t.status === 'closed'
      if (statusFilter === 'Losers')  return t.total_pnl <= 0 && t.status === 'closed'
      return true
    })
    if (tickerFilter)         list = list.filter(t => t.ticker === tickerFilter)
    if (typeFilter !== 'All') list = list.filter(t => t.option_type === typeFilter)
    if (stratFilter)          list = list.filter(t => t.strategy === stratFilter)
    if (flagFilter)           list = list.filter(t => t.flagged)
    if (dateFrom_)         list = list.filter(t => t.date >= dateFrom_)
    if (dateTo_)           list = list.filter(t => t.date <= dateTo_)

    return [...list].sort((a, b) => {
      if (sortBy === 'date-desc')  return b.date.localeCompare(a.date) || b.time.localeCompare(a.time)
      if (sortBy === 'date-asc')   return a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
      if (sortBy === 'pnl-desc')   return b.total_pnl - a.total_pnl
      if (sortBy === 'pnl-asc')    return a.total_pnl - b.total_pnl
      if (sortBy === 'size-desc')  return b.total_cost - a.total_cost
      return 0
    })
  }, [trades, statusFilter, tickerFilter, typeFilter, stratFilter, dateFrom_, dateTo_, sortBy])

  const groups = useMemo(() => {
    if (!groupByDate) return null
    const map = new Map()
    for (const t of displayed) {
      if (!map.has(t.date)) map.set(t.date, [])
      map.get(t.date).push(t)
    }
    return [...map.entries()]
  }, [displayed, groupByDate])

  const handleDelete = id => {
    if (window.confirm('Delete this trade and all its exits?')) deleteMutation.mutate(id)
  }

  // Selection helpers
  const toggleSelect = useCallback(id => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const setSelectExplicit = useCallback((id, val) => {
    setSelected(prev => {
      const next = new Set(prev)
      val ? next.add(id) : next.delete(id)
      return next
    })
  }, [])

  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} trade${selected.size !== 1 ? 's' : ''} and all their exits?`)) return
    selected.forEach(id => deleteMutation.mutate(id))
    setSelected(new Set())
  }

  const handleBulkTag = strategy => {
    selected.forEach(id => updateMutation.mutate({ id, payload: { strategy } }))
    setSelected(new Set())
  }

  const activeFilterCount = [tickerFilter, typeFilter !== 'All' ? typeFilter : '', stratFilter, dateRange !== 'All time' ? dateRange : '', flagFilter ? 'flag' : ''].filter(Boolean).length

  const sharedActions = {
    onAddExit:  trade        => setModal({ mode: 'exit',      trade }),
    onEditExit: (trade, exit) => setModal({ mode: 'edit-exit', trade, exit }),
    onEdit:     trade        => setModal({ mode: 'edit', trade }),
    onDelete:   handleDelete,
    onChart:    trade        => setChartTrade(trade),
    onFlag:     toggleFlag,
  }

  const CompactHeader = () => (
    <div className="flex items-center gap-3 px-3 py-1.5 border border-border bg-muted/20 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      <span className="w-3.5 shrink-0" /><span className="w-3 shrink-0" /><span className="w-3.5 shrink-0" />
      <span className="w-28 shrink-0">Ticker</span>
      <span className="w-20 shrink-0">Expiry</span>
      <span className="w-24 shrink-0">Date</span>
      <span className="w-20 shrink-0">Fill × Qty</span>
      <span className="w-20 shrink-0">Strategy</span>
      <span className="w-12 shrink-0">Status</span>
      <span className="ml-auto shrink-0 pr-1">P&L</span>
      <span className="w-28 shrink-0" />
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      {/* Sticky filter bar */}
      <div className="shrink-0 px-6 pt-5 pb-3 space-y-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{trades.length} trades total <span className="text-muted-foreground/50">· press N to add</span></p>
          <div className="flex items-center gap-2">
            <button onClick={() => setBinOpen(true)} title="Trash" className="p-2 border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={() => setModal({ mode: 'trade', defaultTicker: lastTicker })} className={`${BTN_PRIMARY} flex items-center gap-2 px-4 py-2`}>
              <Plus className="w-4 h-4" /> New Trade
            </button>
          </div>
        </div>

        {/* Row 1: status + core filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-border">
            {STATUS_FILTERS.map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 text-xs font-bold tracking-wide transition-colors border-r border-border last:border-r-0 ${statusFilter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                {f}
              </button>
            ))}
          </div>

          <TickerAutocomplete value={tickerFilter} onChange={setTickerFilter} tickers={tickers} />

          <div className="flex border border-border">
            {['All', 'Call', 'Put'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 text-xs font-bold tracking-wide transition-colors border-r border-border last:border-r-0 ${typeFilter === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                {t === 'All' ? 'ALL TYPES' : t.toUpperCase() + 'S'}
              </button>
            ))}
          </div>

          {strategies.length > 0 && (
            <TickerAutocomplete value={stratFilter} onChange={setStratFilter} tickers={strategies} uppercase={false} placeholder="Strategy…" />
          )}

          {/* Date range */}
          <div className="flex border border-border">
            {DATE_RANGES.map(r => (
              <button key={r} onClick={() => setDateRange(r)}
                className={`px-2.5 py-1.5 text-xs font-semibold transition-colors border-r border-border last:border-r-0 whitespace-nowrap ${dateRange === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                {r}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {dateRange === 'Custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="border border-border bg-card text-xs px-2 py-1.5 text-foreground focus:outline-none focus:border-primary/50" />
              <span className="text-xs text-muted-foreground">–</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="border border-border bg-card text-xs px-2 py-1.5 text-foreground focus:outline-none focus:border-primary/50" />
            </div>
          )}

          {activeFilterCount > 0 && (
            <button onClick={() => { setTickerFilter(''); setTypeFilter('All'); setStratFilter(''); setDateRange('All time'); setFlagFilter(false) }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 border border-border hover:bg-accent transition-colors">
              <X className="w-3 h-3" /> Clear ({activeFilterCount})
            </button>
          )}

          <div className="flex border border-border ml-auto">
            {SORT_OPTS.map(o => (
              <button key={o.id} onClick={() => setSortBy(o.id)}
                className={`px-3 py-1.5 text-xs font-bold tracking-wide transition-colors border-r border-border last:border-r-0 ${sortBy === o.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
                {o.label}
              </button>
            ))}
          </div>

          <button onClick={() => setFlagFilter(f => !f)} title="Show flagged only"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold border transition-colors ${flagFilter ? 'bg-amber-400/20 text-amber-300 border-amber-400/40' : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
            <Flag className="w-3.5 h-3.5" /> Flagged
          </button>

          <button onClick={() => { setSelectionMode(m => { if (m) setSelected(new Set()); return !m }) }} title="Select trades"
            className={`p-1.5 border border-border transition-colors ${selectionMode ? 'bg-primary/20 text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setGroupByDate(g => !g)} title="Group by date"
            className={`p-1.5 border border-border transition-colors ${groupByDate ? 'bg-primary/20 text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setCompact(c => !c)} title={compact ? 'Detailed view' : 'Compact view'}
            className={`p-1.5 border border-border transition-colors ${compact ? 'bg-primary/20 text-primary border-primary/40' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}>
            {compact ? <LayoutList className="w-3.5 h-3.5" /> : <Table2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">

        {!isLoading && displayed.length > 0 && <SummaryBar trades={displayed} />}

        {selected.size > 0 && (
          <BulkBar count={selected.size} onDelete={handleBulkDelete} onTag={handleBulkTag} onClear={() => setSelected(new Set())} />
        )}

        {!isLoading && compact && !groupByDate && displayed.length > 0 && <CompactHeader />}

        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className={`${CARD} p-4 h-24 animate-pulse`} />)}</div>
        ) : displayed.length === 0 ? (
          <div className={`${CARD} text-center py-20`}>
            <p className="text-sm text-muted-foreground">No trades found.</p>
            {statusFilter === 'All' && !tickerFilter && !stratFilter && typeFilter === 'All' && dateRange === 'All time' && (
              <button onClick={() => setModal({ mode: 'trade', defaultTicker: lastTicker })} className="mt-3 text-primary text-sm hover:underline">Add your first trade</button>
            )}
          </div>
        ) : groupByDate ? (
          <div className="space-y-4">
            {compact && <CompactHeader />}
            {groups.map(([date, ts]) => (
              <DateGroup key={date} date={date} trades={ts} compact={compact}
                selected={selected} onSelect={(id, val) => val !== undefined ? setSelectExplicit(id, val) : toggleSelect(id)}
                selectionMode={selectionMode}
                {...sharedActions} />
            ))}
          </div>
        ) : (
          <div className={compact ? 'space-y-px' : 'space-y-2'}>
            {displayed.map(t =>
              compact
                ? <TradeRow  key={t.id} trade={t} selected={selected.has(t.id)} onSelect={toggleSelect} selectionMode={selectionMode} {...sharedActions} />
                : <TradeCard key={t.id} trade={t} selected={selected.has(t.id)} onSelect={toggleSelect} selectionMode={selectionMode} {...sharedActions} />
            )}
          </div>
        )}
      </div>

      {modal && <TradeModal mode={modal.mode} trade={modal.trade} exit={modal.exit} defaultTicker={modal.defaultTicker} onClose={() => setModal(null)} />}
      {chartTrade && (
        <TradeChart trade={chartTrade} defaultEditOpen={chartEditOpen}
          onClose={() => { setChartTrade(null); setChartEditOpen(false) }} />
      )}
      {binOpen && <TrashBin accountId={accountId} onClose={() => setBinOpen(false)} />}
    </div>
  )
}
