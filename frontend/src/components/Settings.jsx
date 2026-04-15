import { useState, useRef } from 'react'
import { ChevronDown, Download, Upload, CheckCircle2, AlertCircle, Pencil, Trash2, Plus, X, RefreshCw } from 'lucide-react'
import { getChartSettings, saveChartSettings, DEFAULTS } from '../chartSettings'
import { getTimezone, saveTimezone, TIMEZONE_OPTIONS, getTzOffset } from '../timezone'
import { getAppSettings, saveAppSettings, applyFontSize, MOOD_COLORS, getMoodStyle, DEFAULT_MOODS } from '../appSettings'
import { useAccount } from '../AccountContext'
import { createAccount, renameAccount, deleteAccount } from '../api'

const LABEL = 'block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5'
const INPUT = 'w-full border border-border bg-muted/30 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-primary transition-colors'
const CARD  = 'border border-border bg-card'

const SAVE_BTN = (saved) => ({
  background: saved ? '#16a34a22' : 'hsl(var(--primary)/0.15)',
  color:      saved ? '#4ade80'   : 'hsl(var(--primary))',
  border:     `1px solid ${saved ? '#16a34a44' : 'hsl(var(--primary)/0.3)'}`,
})

function CollapseHeader({ title, summary, open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-5 py-4 hover:bg-accent/30 transition-colors text-left"
    >
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
        {!open && summary && (
          <p className="text-xs text-foreground font-mono mt-0.5 opacity-70">{summary}</p>
        )}
      </div>
      <ChevronDown
        size={14}
        className={`text-muted-foreground transition-transform shrink-0 ml-4 ${open ? 'rotate-180' : ''}`}
      />
    </button>
  )
}

function NumField({ label, value, min, max, step, unit, onChange }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          className={INPUT}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
        />
        {unit && <span className="text-xs text-muted-foreground shrink-0 w-12">{unit}</span>}
      </div>
    </div>
  )
}

function ModeToggle({ value, onChange }) {
  return (
    <div className="flex border border-border text-[10px] font-bold uppercase tracking-wider shrink-0">
      {['pct', 'fixed'].map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2.5 py-1 transition-colors ${
            value === m
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          {m === 'pct' ? '%' : '$'}
        </button>
      ))}
    </div>
  )
}

function RiskTargetSection() {
  const [open, setOpen]       = useState(false)
  const [cfg, setCfg]         = useState(() => getAppSettings())
  const [saved, setSaved]     = useState(false)
  const [display, setDisplay] = useState('$')

  const balance     = cfg.accountBalance || 0
  const riskAmount  = cfg.dailyRiskMode   === 'pct' ? balance * cfg.dailyRiskPct   / 100 : cfg.dailyRiskFixed
  const targetAmount = cfg.dailyTargetMode === 'pct' ? balance * cfg.dailyTargetPct / 100 : cfg.dailyTargetFixed

  const fmtInline = (amount, pctVal) => {
    if (display === '$') {
      if (amount <= 0 && balance <= 0) return null
      return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    } else {
      if (balance <= 0) return null
      return `${pctVal.toFixed(1)}%`
    }
  }

  const riskInline = cfg.dailyRiskMode === 'pct'
    ? fmtInline(riskAmount, cfg.dailyRiskPct)
    : (balance > 0 ? (display === '$' ? `$${cfg.dailyRiskFixed.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `${((cfg.dailyRiskFixed / balance) * 100).toFixed(1)}%`) : null)

  const targetInline = cfg.dailyTargetMode === 'pct'
    ? fmtInline(targetAmount, cfg.dailyTargetPct)
    : (balance > 0 ? (display === '$' ? `$${cfg.dailyTargetFixed.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `${((cfg.dailyTargetFixed / balance) * 100).toFixed(1)}%`) : null)

  const riskSummary  = cfg.dailyRiskMode   === 'pct' ? `${cfg.dailyRiskPct}%`   : `$${cfg.dailyRiskFixed}`
  const targetSummary = cfg.dailyTargetMode === 'pct' ? `${cfg.dailyTargetPct}%` : `$${cfg.dailyTargetFixed}`
  const summary = `Risk ${riskSummary} · Target ${targetSummary}`

  const handleSave = () => {
    saveAppSettings(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className={CARD}>
      <CollapseHeader title="Risk & Targets" summary={summary} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
          <div className="flex justify-end">
            <div className="flex border border-border text-[10px] font-bold uppercase tracking-wider shrink-0">
              {['$', '%'].map(m => (
                <button
                  key={m}
                  onClick={() => setDisplay(m)}
                  className={`px-2.5 py-1.5 transition-colors ${
                    display === m
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL}>Overtrading threshold</label>
            <div className="flex items-center gap-2">
              <input
                className={INPUT}
                type="number"
                min={1.0} max={5.0} step={0.1}
                value={cfg.overtradingMultiplier}
                onChange={e => setCfg(c => ({ ...c, overtradingMultiplier: parseFloat(e.target.value) || 1.5 }))}
              />
              <span className="text-xs text-muted-foreground shrink-0 w-12">{cfg.overtradingMultiplier}×</span>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Flag days where trade count exceeds {cfg.overtradingMultiplier}× your daily average.
            </p>
          </div>

          <div>
            <label className={LABEL}>Account balance</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono shrink-0">$</span>
              <input
                className={INPUT}
                type="number"
                min={0}
                step={100}
                value={cfg.accountBalance}
                onChange={e => setCfg(c => ({ ...c, accountBalance: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>Risk for day</label>
            <div className="flex items-center gap-2">
              <input
                className={INPUT}
                type="number"
                min={0}
                step={cfg.dailyRiskMode === 'pct' ? 0.5 : 50}
                value={cfg.dailyRiskMode === 'pct' ? cfg.dailyRiskPct : cfg.dailyRiskFixed}
                onChange={e => {
                  const v = parseFloat(e.target.value) || 0
                  setCfg(c => cfg.dailyRiskMode === 'pct' ? { ...c, dailyRiskPct: v } : { ...c, dailyRiskFixed: v })
                }}
              />
              <ModeToggle value={cfg.dailyRiskMode} onChange={v => setCfg(c => ({ ...c, dailyRiskMode: v }))} />
              {riskInline && <span className="font-mono text-sm font-semibold text-rose-400 shrink-0 min-w-[52px] text-right">{riskInline}</span>}
            </div>
          </div>

          <div>
            <label className={LABEL}>Target for day</label>
            <div className="flex items-center gap-2">
              <input
                className={INPUT}
                type="number"
                min={0}
                step={cfg.dailyTargetMode === 'pct' ? 0.5 : 50}
                value={cfg.dailyTargetMode === 'pct' ? cfg.dailyTargetPct : cfg.dailyTargetFixed}
                onChange={e => {
                  const v = parseFloat(e.target.value) || 0
                  setCfg(c => cfg.dailyTargetMode === 'pct' ? { ...c, dailyTargetPct: v } : { ...c, dailyTargetFixed: v })
                }}
              />
              <ModeToggle value={cfg.dailyTargetMode} onChange={v => setCfg(c => ({ ...c, dailyTargetMode: v }))} />
              {targetInline && <span className="font-mono text-sm font-semibold text-emerald-400 shrink-0 min-w-[52px] text-right">{targetInline}</span>}
            </div>
          </div>

          <button onClick={handleSave} className="w-full py-2 text-xs font-bold uppercase tracking-wider transition-colors" style={SAVE_BTN(saved)}>
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

function MoodsSection() {
  const [open, setOpen]       = useState(false)
  const [moods, setMoods]     = useState(() => getAppSettings().moods ?? DEFAULT_MOODS)
  const [editIdx, setEditIdx] = useState(null)

  function persist(next) {
    const s = getAppSettings()
    saveAppSettings({ ...s, moods: next })
    setMoods(next)
  }

  function handleLabelChange(idx, label) {
    setMoods(prev => prev.map((m, i) => i === idx ? { ...m, label } : m))
  }

  function handleLabelCommit(idx) {
    const next = moods.map((mood, i) => {
      if (i !== idx) return mood
      const slug = mood.value.startsWith('new-')
        ? mood.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || mood.value
        : mood.value
      return { ...mood, value: slug }
    })
    persist(next)
    setEditIdx(null)
  }

  function handleColorChange(idx, colorId) {
    persist(moods.map((m, i) => i === idx ? { ...m, color: colorId } : m))
  }

  function handleRemove(idx) {
    persist(moods.filter((_, i) => i !== idx))
  }

  function handleAdd() {
    const next = [...moods, { value: `new-${Date.now()}`, label: 'New Mood', color: 'blue' }]
    setMoods(next)
    setEditIdx(next.length - 1)
    if (!open) setOpen(true)
  }

  const summary = `${moods.length} mood${moods.length !== 1 ? 's' : ''}`

  return (
    <div className={CARD}>
      <CollapseHeader title="Journal Moods" summary={summary} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-2">
          {moods.map((m, idx) => {
            const style = getMoodStyle(m.color)
            return (
              <div key={m.value} className="flex items-center gap-3">
                <div
                  className="border px-3 py-1 text-[10px] font-bold uppercase tracking-widest min-w-[100px] cursor-text"
                  style={style}
                >
                  {editIdx === idx ? (
                    <input
                      autoFocus
                      value={m.label}
                      onChange={e => handleLabelChange(idx, e.target.value)}
                      onBlur={() => handleLabelCommit(idx)}
                      onKeyDown={e => e.key === 'Enter' && handleLabelCommit(idx)}
                      className="bg-transparent outline-none w-full font-bold uppercase tracking-widest text-[10px]"
                      style={{ color: style.color }}
                    />
                  ) : (
                    <span onClick={() => setEditIdx(idx)}>{m.label}</span>
                  )}
                </div>

                <div className="flex gap-1.5 flex-1">
                  {MOOD_COLORS.map(c => (
                    <button
                      key={c.id}
                      title={c.label}
                      onClick={() => handleColorChange(idx, c.id)}
                      className="w-4 h-4 rounded-full transition-all shrink-0"
                      style={{
                        backgroundColor: c.swatch,
                        outline: m.color === c.id ? `2px solid ${c.swatch}` : 'none',
                        outlineOffset: '2px',
                      }}
                    />
                  ))}
                </div>

                <button onClick={() => handleRemove(idx)} className="p-1 text-muted-foreground/40 hover:text-rose-400 transition-colors shrink-0">
                  <X size={12} />
                </button>
              </div>
            )
          })}

          <button onClick={handleAdd} className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Plus size={12} /> Add mood
          </button>
        </div>
      )}
    </div>
  )
}

function AccountsSection() {
  const [open, setOpen]                 = useState(false)
  const { accounts, reload, accountId, select } = useAccount()
  const [newName, setNewName]           = useState('')
  const [editId, setEditId]             = useState(null)
  const [editName, setEditName]         = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteAction, setDeleteAction] = useState('reassign')
  const [reassignTo, setReassignTo]     = useState('')
  const [err, setErr]                   = useState('')

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      await createAccount(newName.trim())
      setNewName('')
      reload()
    } catch (e) { setErr(e.message) }
  }

  const handleRename = async (id) => {
    if (!editName.trim()) return
    try {
      await renameAccount(id, editName.trim())
      setEditId(null)
      reload()
    } catch (e) { setErr(e.message) }
  }

  const handleDelete = async () => {
    try {
      const to = deleteAction === 'reassign' ? Number(reassignTo) : undefined
      await deleteAccount(deleteTarget.id, deleteAction, to)
      if (accountId === deleteTarget.id) select(null)
      setDeleteTarget(null)
      reload()
    } catch (e) { setErr(e.message) }
  }

  const others  = accounts.filter(a => a.id !== deleteTarget?.id)
  const summary = accounts.map(a => a.name).join(', ')

  return (
    <div className={CARD}>
      <CollapseHeader title="Accounts" summary={summary} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (
        <div className="border-t border-border">
          {err && (
            <div className="mx-5 mt-3 px-4 py-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 flex items-center justify-between">
              {err}
              <button onClick={() => setErr('')}><X size={12} /></button>
            </div>
          )}

          <div className="px-5 py-3 space-y-1">
            {accounts.map(a => (
              <div key={a.id} className="flex items-center gap-2 py-1.5">
                {editId === a.id ? (
                  <>
                    <input
                      className={`${INPUT} flex-1 text-xs py-1`}
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRename(a.id)}
                      autoFocus
                    />
                    <button onClick={() => handleRename(a.id)} className="text-xs text-primary font-semibold px-2">Save</button>
                    <button onClick={() => setEditId(null)} className="text-xs text-muted-foreground px-1"><X size={12} /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-foreground">{a.name}</span>
                    <button onClick={() => { setEditId(a.id); setEditName(a.name) }} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => { setDeleteTarget(a); setDeleteAction('reassign'); setReassignTo(others[0]?.id ?? '') }}
                      className="p-1 text-muted-foreground hover:text-rose-400 transition-colors"
                      disabled={accounts.length <= 1}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="px-5 pb-4 flex gap-2">
            <input
              className={`${INPUT} flex-1 text-xs`}
              placeholder="New account name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Plus size={12} /> Add
            </button>
          </div>

          {deleteTarget && (
            <div className="mx-5 mb-4 p-4 border border-rose-500/30 bg-rose-500/5 space-y-3">
              <p className="text-xs font-semibold text-rose-400">Delete "{deleteTarget.name}"</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input type="radio" value="reassign" checked={deleteAction === 'reassign'} onChange={() => setDeleteAction('reassign')} />
                  Reassign trades to another account
                </label>
                {deleteAction === 'reassign' && (
                  <select
                    className="w-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none"
                    value={reassignTo}
                    onChange={e => setReassignTo(e.target.value)}
                  >
                    {others.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input type="radio" value="delete_trades" checked={deleteAction === 'delete_trades'} onChange={() => setDeleteAction('delete_trades')} />
                  Delete all trades in this account
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={handleDelete} className="px-3 py-1.5 text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 transition-colors">
                  Confirm Delete
                </button>
                <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-xs font-bold border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const FONT_SIZES = [90, 95, 100, 105, 110, 115, 120, 125, 130]

function FontSizeSection({ appCfg, setAppCfg }) {
  const [open, setOpen] = useState(false)
  const current = appCfg.fontSize ?? 110
  const summary = `${current}%`

  function handleChange(pct) {
    const next = { ...appCfg, fontSize: pct }
    setAppCfg(next)
    saveAppSettings(next)
    applyFontSize(pct)
  }

  return (
    <div className={CARD}>
      <CollapseHeader title="Font Size" summary={summary} open={open} onToggle={() => setOpen(o => !o)} />
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4">
          <div className="flex items-center gap-2 flex-wrap">
            {FONT_SIZES.map(pct => (
              <button
                key={pct}
                onClick={() => handleChange(pct)}
                className={`px-3 py-1.5 text-xs font-bold border transition-colors ${
                  current === pct
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary hover:text-foreground'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-3">Preview: <span style={{ fontSize: `${current / 100}em` }}>The quick brown fox</span></p>
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const [cfg, setCfg]         = useState(() => getChartSettings())
  const [saved, setSaved]     = useState(false)
  const [chartOpen, setChartOpen]   = useState(false)
  const [tzOpen, setTzOpen]         = useState(false)
  const [hoursOpen, setHoursOpen]   = useState(false)
  const [maeOpen, setMaeOpen]       = useState(false)
  const [dataOpen, setDataOpen]     = useState(false)
  const [tz, setTz]           = useState(() => getTimezone())
  const [appCfg, setAppCfg]   = useState(() => getAppSettings())
  const [hoursSaved, setHoursSaved] = useState(false)
  const [maeSaved, setMaeSaved]     = useState(false)
  const [importStatus, setImportStatus] = useState(null)
  const [importMsg, setImportMsg]       = useState('')
  const [recomputeStatus, setRecomputeStatus] = useState(null)
  const [recomputeMsg, setRecomputeMsg]       = useState('')
  const fileRef = useRef()

  const set = key => val => setCfg(c => ({ ...c, [key]: val }))

  const handleSave = () => {
    saveChartSettings(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleReset = () => setCfg({ ...DEFAULTS })

  const handleTzChange = (e) => {
    const val = e.target.value
    setTz(val)
    saveTimezone(val)
  }

  const handleHoursSave = () => {
    saveAppSettings(appCfg)
    setHoursSaved(true)
    setTimeout(() => setHoursSaved(false), 1500)
  }

  const handleMaeSave = () => {
    saveAppSettings(appCfg)
    setMaeSaved(true)
    setTimeout(() => setMaeSaved(false), 1500)
  }

  const handleExport = async () => {
    const res  = await fetch('/api/data/export')
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `trading-journal-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    try {
      const text   = await file.text()
      const parsed = JSON.parse(text)
      const res    = await fetch('/api/data/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...parsed, clear_existing: false }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.detail || 'Import failed')
      setImportMsg(`Imported ${result.imported_trades} trades · ${result.imported_exits} exits`)
      setImportStatus('success')
    } catch (err) {
      setImportMsg(err.message)
      setImportStatus('error')
    }
    setTimeout(() => setImportStatus(null), 4000)
  }

  const handleRecompute = async (date) => {
    setRecomputeStatus('loading')
    try {
      const qs  = date ? `?date=${date}` : ''
      const res    = await fetch(`/api/admin/recompute-all${qs}`, { method: 'POST' })
      const result = await res.json()
      if (!res.ok) throw new Error(result.detail || 'Recompute failed')
      setRecomputeMsg(`Recomputed ${result.recomputed} exits${date ? ` for ${date}` : ''}`)
      setRecomputeStatus('done')
    } catch (err) {
      setRecomputeMsg(err.message)
      setRecomputeStatus('error')
    }
    setTimeout(() => setRecomputeStatus(null), 4000)
  }

  const chartSummary = `Top ${(cfg.marginTop * 100).toFixed(0)}% · Bottom ${(cfg.marginBottom * 100).toFixed(0)}% · Right ${cfg.rightBars} bars`
  const tzOpt        = TIMEZONE_OPTIONS.find(o => o.value === tz)
  const tzSummary    = tzOpt ? `${getTzOffset(tz)} · ${tzOpt.label}` : tz
  const hoursSummary = `${appCfg.tradingStart} – ${appCfg.tradingEnd}`
  const maeSummary   = `MFE ${appCfg.processWinThreshold}% · MAE ${appCfg.processMaeThreshold ?? 30}%`

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-lg space-y-3">

        {/* ── Accounts ─────────────────────────────────────────────────────── */}
        <AccountsSection />

        {/* ── Timezone ─────────────────────────────────────────────────────── */}
        <div className={CARD}>
          <CollapseHeader title="Timezone" summary={tzSummary} open={tzOpen} onToggle={() => setTzOpen(o => !o)} />
          {tzOpen && (
            <div className="px-5 pb-5 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-3">Used for date/time defaults when logging trades and for chart time labels.</p>
              <select
                value={tz}
                onChange={handleTzChange}
                className="w-full border border-border bg-muted/30 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-primary transition-colors"
              >
                {TIMEZONE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {getTzOffset(opt.value)} — {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Trading Hours ─────────────────────────────────────────────────── */}
        <div className={CARD}>
          <CollapseHeader title="Trading Hours" summary={hoursSummary} open={hoursOpen} onToggle={() => setHoursOpen(o => !o)} />
          {hoursOpen && (
            <div className="px-5 pb-5 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-3">Used to calculate post-exit MFE — how much a trade moved after you closed it.</p>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className={LABEL}>Session start</label>
                  <input type="time" value={appCfg.tradingStart} onChange={e => setAppCfg(c => ({ ...c, tradingStart: e.target.value }))} className={INPUT} />
                </div>
                <div className="flex-1">
                  <label className={LABEL}>Session end</label>
                  <input type="time" value={appCfg.tradingEnd} onChange={e => setAppCfg(c => ({ ...c, tradingEnd: e.target.value }))} className={INPUT} />
                </div>
              </div>
              <button onClick={handleHoursSave} className="mt-3 w-full py-2 text-xs font-bold uppercase tracking-wider transition-colors" style={SAVE_BTN(hoursSaved)}>
                {hoursSaved ? '✓ Saved' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* ── Risk & Targets ───────────────────────────────────────────────── */}
        <RiskTargetSection />

        {/* ── Journal Moods ────────────────────────────────────────────────── */}
        <MoodsSection />

        {/* ── MAE / MFE ────────────────────────────────────────────────────── */}
        <div className={CARD}>
          <CollapseHeader title="MAE / MFE" summary={maeSummary} open={maeOpen} onToggle={() => setMaeOpen(o => !o)} />
          {maeOpen && (
            <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
              <div>
                <NumField
                  label="Good Setup threshold (MFE)"
                  value={appCfg.processWinThreshold}
                  min={1} max={200} step={1}
                  unit={`${appCfg.processWinThreshold}%`}
                  onChange={v => setAppCfg(c => ({ ...c, processWinThreshold: v }))}
                />
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  A losing trade gets a "Good Setup" badge and counts as an adjusted win if MFE ≥ {appCfg.processWinThreshold}%.
                </p>
              </div>
              <div>
                <NumField
                  label="Stop threshold (MAE)"
                  value={appCfg.processMaeThreshold ?? 30}
                  min={1} max={200} step={1}
                  unit={`${appCfg.processMaeThreshold ?? 30}%`}
                  onChange={v => setAppCfg(c => ({ ...c, processMaeThreshold: v }))}
                />
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Used in the MFE·MAE edge calculation — avg loss assumes you stopped out at {appCfg.processMaeThreshold ?? 30}% adverse move.
                </p>
              </div>
              <button onClick={handleMaeSave} className="w-full py-2 text-xs font-bold uppercase tracking-wider transition-colors" style={SAVE_BTN(maeSaved)}>
                {maeSaved ? '✓ Saved' : 'Save'}
              </button>
              <div className="flex gap-3 flex-wrap pt-1 border-t border-border">
                <button
                  onClick={() => handleRecompute()}
                  disabled={recomputeStatus === 'loading'}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={12} className={recomputeStatus === 'loading' ? 'animate-spin' : ''} />
                  Recompute MAE/MFE
                </button>
                <button
                  onClick={() => handleRecompute(new Date().toISOString().slice(0, 10))}
                  disabled={recomputeStatus === 'loading'}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={12} className={recomputeStatus === 'loading' ? 'animate-spin' : ''} />
                  Today Only
                </button>
              </div>
              {recomputeStatus && recomputeStatus !== 'loading' && (
                <div className={`px-4 py-2.5 flex items-center gap-2 text-xs ${recomputeStatus === 'done' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {recomputeStatus === 'done' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {recomputeMsg}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Chart Defaults ───────────────────────────────────────────────── */}
        <div className={CARD}>
          <CollapseHeader title="Chart Defaults" summary={chartSummary} open={chartOpen} onToggle={() => setChartOpen(o => !o)} />
          {chartOpen && (
            <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
              <NumField label="Top margin"           value={cfg.marginTop}    min={0.01} max={0.48} step={0.01} unit={`${(cfg.marginTop * 100).toFixed(0)}%`}    onChange={set('marginTop')} />
              <NumField label="Bottom margin"        value={cfg.marginBottom} min={0.01} max={0.48} step={0.01} unit={`${(cfg.marginBottom * 100).toFixed(0)}%`} onChange={set('marginBottom')} />
              <NumField label="Right-side empty bars" value={cfg.rightBars}   min={0}    max={50}   step={1}    unit="bars"                                       onChange={set('rightBars')} />
              <div className="flex gap-2 pt-1">
                <button onClick={handleSave}  className="flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors" style={SAVE_BTN(saved)}>{saved ? '✓ Saved' : 'Save'}</button>
                <button onClick={handleReset} className="px-4 py-2 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Reset</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Font Size ────────────────────────────────────────────────────── */}
        <FontSizeSection appCfg={appCfg} setAppCfg={setAppCfg} />

        {/* ── Data Import / Export ─────────────────────────────────────────── */}
        <div className={CARD}>
          <CollapseHeader title="Data" summary="Export / Import" open={dataOpen} onToggle={() => setDataOpen(o => !o)} />
          {dataOpen && (
            <div className="border-t border-border px-5 py-4">
              <p className="text-xs text-muted-foreground mb-4">Export all trades and exits as JSON, or import a previously exported file.</p>
              <div className="flex gap-3 flex-wrap">
                <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Download size={12} /> Export JSON
                </button>
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Upload size={12} /> Import JSON
                </button>
                <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              </div>
              {importStatus && (
                <div className={`mt-4 px-4 py-2.5 flex items-center gap-2 text-xs ${importStatus === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {importStatus === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {importMsg}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
