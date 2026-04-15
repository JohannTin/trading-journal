import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Save, ExternalLink, Flag, Search, X, ImagePlus, Trash2, RotateCcw, Tag, Pencil, Eye } from 'lucide-react'
import { getJournalEntry, upsertJournalEntry, getTrades, getJournalDates, getCalendarStats, searchJournalEntries, getJournalImages, uploadJournalImage, deleteJournalImage, deleteJournalEntry, getDeletedJournalEntries, restoreJournalEntry, permanentDeleteJournalEntry, getJournalTags } from '../api'
import { useAccount } from '../AccountContext'
import Calendar from './Calendar'
import TradeChart from './TradeChart'
import { getAppSettings, DEFAULT_MOODS, getMoodStyle } from '../appSettings'

function TagInput({ value, onChange, suggestions = [] }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)

  const filtered = suggestions.filter(
    s => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  )

  function addTag(raw) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setInput('')
    setOpen(false)
  }

  function removeTag(tag) {
    onChange(value.filter(t => t !== tag))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (input.trim()) addTag(input)
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  const showDropdown = open && (filtered.length > 0 || input.trim())

  return (
    <div className="relative">
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-border bg-muted/20 min-h-[36px] items-center cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map(tag => (
          <span
            key={tag}
            className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-widest"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag) }}
              className="hover:text-primary/60"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length === 0 ? 'Add tags…' : ''}
          className="flex-1 min-w-[80px] bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
      </div>
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 z-20 border border-border bg-card shadow-lg max-h-36 overflow-y-auto">
          {filtered.map(tag => (
            <button
              key={tag}
              type="button"
              onMouseDown={() => addTag(tag)}
              className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
            >
              {tag}
            </button>
          ))}
          {input.trim() && !value.includes(input.trim().toLowerCase().replace(/\s+/g, '-')) && (
            <button
              type="button"
              onMouseDown={() => addTag(input)}
              className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-accent transition-colors"
            >
              Create &ldquo;{input.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10)
}

function prettyDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function dollar(v) {
  const abs = Math.abs(v).toFixed(2)
  return v >= 0 ? `+$${abs}` : `-$${abs}`
}

function JournalImages({ date }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState(null) // filename

  const { data: images = [] } = useQuery({
    queryKey: ['journal-images', date],
    queryFn: () => getJournalImages(date),
  })

  const uploadMutation = useMutation({
    mutationFn: (file) => uploadJournalImage(date, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journal-images', date] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteJournalImage(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journal-images', date] }),
  })

  function handleFiles(files) {
    Array.from(files).forEach(f => {
      if (f.type.startsWith('image/')) uploadMutation.mutate(f)
    })
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="border border-border bg-card p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Screenshots</p>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border border-dashed flex items-center justify-center gap-2 py-3 cursor-pointer transition-colors mb-3 ${
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
        }`}
      >
        <ImagePlus className="w-4 h-4 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground/50">
          {uploadMutation.isPending ? 'Uploading…' : 'Drop images or click to upload'}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map(img => (
            <div key={img.id} className="relative group">
              <img
                src={`/uploads/journal/${img.filename}`}
                alt=""
                onClick={() => setLightbox(img.filename)}
                className="w-full aspect-video object-cover border border-border cursor-pointer hover:opacity-90 transition-opacity"
              />
              <button
                onClick={() => deleteMutation.mutate(img.id)}
                className="absolute top-1 right-1 bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600"
              >
                <Trash2 className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={`/uploads/journal/${lightbox}`}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function JournalTrash({ onClose, onRestore }) {
  const queryClient = useQueryClient()

  const { data: deleted = [], isLoading } = useQuery({
    queryKey: ['journal-deleted'],
    queryFn: () => getDeletedJournalEntries(),
  })

  const restoreMutation = useMutation({
    mutationFn: (id) => restoreJournalEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      queryClient.invalidateQueries({ queryKey: ['journal-dates'] })
      queryClient.invalidateQueries({ queryKey: ['journal-deleted'] })
      onRestore?.()
    },
  })

  const permDeleteMutation = useMutation({
    mutationFn: (id) => permanentDeleteJournalEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-deleted'] })
    },
  })

  function handlePermDelete(id) {
    if (!window.confirm('Permanently delete this journal entry? This cannot be undone.')) return
    permDeleteMutation.mutate(id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border w-full max-w-lg max-h-[70vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Journal Trash</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2">
          {isLoading ? (
            <p className="text-xs text-muted-foreground/50 text-center py-8">Loading…</p>
          ) : deleted.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 text-center py-8">Trash is empty</p>
          ) : deleted.map(j => {
            const moods = getAppSettings().moods ?? DEFAULT_MOODS
            const moodMeta = j.mood ? moods.find(m => m.value === j.mood) : null
            const preview = j.pre_market || j.went_well || j.to_improve || ''
            return (
              <div key={j.id} className="flex items-start gap-3 p-3 border border-border hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-foreground">{j.date}</span>
                    {moodMeta && (
                      <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border" style={getMoodStyle(moodMeta.color)}>
                        {moodMeta.label}
                      </span>
                    )}
                    {j.flagged && <Flag className="w-3 h-3 text-amber-400" />}
                  </div>
                  {preview && (
                    <p className="text-[11px] text-muted-foreground/60 truncate">{preview}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground/40 mt-1">
                    Deleted {new Date(j.deleted_at + 'Z').toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => restoreMutation.mutate(j.id)}
                    disabled={restoreMutation.isPending}
                    title="Restore"
                    className="p-1.5 text-muted-foreground/60 hover:text-green-400 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handlePermDelete(j.id)}
                    disabled={permDeleteMutation.isPending}
                    title="Delete permanently"
                    className="p-1.5 text-muted-foreground/60 hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        {deleted.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex justify-end">
            <button
              onClick={() => {
                if (!window.confirm(`Permanently delete all ${deleted.length} entries? This cannot be undone.`)) return
                Promise.all(deleted.map(j => permanentDeleteJournalEntry(j.id))).then(() => {
                  queryClient.invalidateQueries({ queryKey: ['journal-deleted'] })
                })
              }}
              className="text-[10px] font-bold uppercase tracking-widest text-rose-400/70 hover:text-rose-400 transition-colors"
            >
              Empty Trash
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Journal() {
  const today = toDateStr(new Date())
  const [date, setDate] = useState(today)
  const { accountId } = useAccount()
  const queryClient = useQueryClient()
  const [chartTrade, setChartTrade] = useState(null)
  const [searchQ, setSearchQ] = useState('')
  const [searchMood, setSearchMood] = useState(null)
  const [searchTag, setSearchTag] = useState(null)
  const [searchFlagged, setSearchFlagged] = useState(false)

  const isSearching = searchQ.trim() !== '' || searchMood !== null || searchTag !== null || searchFlagged

  const { data: searchResults = [] } = useQuery({
    queryKey: ['journal-search', searchQ, searchMood, searchTag, searchFlagged],
    queryFn: () => searchJournalEntries({ q: searchQ.trim() || undefined, mood: searchMood || undefined, tag: searchTag || undefined, flagged: searchFlagged || undefined }),
    enabled: isSearching,
  })

  const { data: allTags = [] } = useQuery({
    queryKey: ['journal-tags'],
    queryFn: () => getJournalTags(),
  })

  const moods = getAppSettings().moods ?? DEFAULT_MOODS
  const [form, setForm] = useState({ pre_market: '', went_well: '', to_improve: '', mood: null, flagged: false, tags: [] })
  const [saved, setSaved] = useState(false)
  const [viewMode, setViewMode] = useState(true)
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [calendarOffset, setCalendarOffset] = useState(0)
  const pickerRef = useRef(null)

  // Fetch journal entry for this date
  const { data: entry } = useQuery({
    queryKey: ['journal', date],
    queryFn: () => getJournalEntry(date),
  })

  // Used to highlight which days have entries in the picker.
  const { data: journalDates = [] } = useQuery({
    queryKey: ['journal-dates'],
    queryFn: () => getJournalDates(),
  })

  // Calendar P&L coloring
  const { data: calendarStats = [] } = useQuery({
    queryKey: ['stats-calendar', accountId],
    queryFn: () => getCalendarStats(accountId),
  })

  // Left rail: most recent journal entries (for quick navigation).
  const recentDates = [...journalDates].slice(-6).reverse()
  const { data: recentEntries = [] } = useQuery({
    queryKey: ['journal-recent', recentDates],
    queryFn: async () => Promise.all(recentDates.map(d => getJournalEntry(d))).then(arr => arr.filter(Boolean)),
    enabled: recentDates.length > 0,
  })

  // Fetch all trades (to filter by date)
  const { data: allTrades = [] } = useQuery({
    queryKey: ['trades', null, accountId, null],
    queryFn: () => getTrades(null, accountId, null),
  })

  const dayTrades = allTrades.filter(t => t.date === date)
  const dayPnl = dayTrades.reduce((sum, t) => sum + (t.total_pnl ?? 0), 0)

  // Sync entry into form state whenever date/entry changes
  useEffect(() => {
    if (entry) {
      setForm({
        pre_market: entry.pre_market ?? '',
        went_well:  entry.went_well  ?? '',
        to_improve: entry.to_improve ?? '',
        mood:       entry.mood       ?? null,
        flagged:    entry.flagged    ?? false,
        tags:       entry.tags       ?? [],
      })
    } else {
      setForm({ pre_market: '', went_well: '', to_improve: '', mood: null, flagged: false, tags: [] })
    }
    setSaved(false)
    // View mode: past dates always view; today with existing entry → view; today with no entry → edit
    const isPast = date < today
    setViewMode(isPast || (date === today && !!entry))
  }, [entry, date])

  const mutation = useMutation({
    mutationFn: (data) => upsertJournalEntry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const flagMutation = useMutation({
    mutationFn: (data) => upsertJournalEntry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal', date] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteJournalEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      queryClient.invalidateQueries({ queryKey: ['journal-dates'] })
      queryClient.invalidateQueries({ queryKey: ['journal-search'] })
      setDate(today)
    },
  })

  function handleDelete() {
    if (!entry?.id) return
    if (!window.confirm('Move this journal entry to trash?')) return
    deleteMutation.mutate(entry.id)
  }

  function handleSave() {
    mutation.mutate({ date, ...form })
  }

  function toggleFlag() {
    const next = !form.flagged
    setForm(f => ({ ...f, flagged: next }))
    flagMutation.mutate({ date, ...form, flagged: next })
  }

  function shift(days) {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    const next = toDateStr(d)
    if (next <= today) setDate(next)
  }

  const isToday = date === today

  useEffect(() => {
    if (!datePickerOpen) return
    const onDown = (e) => {
      if (!pickerRef.current) return
      if (!pickerRef.current.contains(e.target)) setDatePickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [datePickerOpen])

  function calcMonthOffset(targetDate) {
    const d = new Date(targetDate + 'T12:00:00')
    const t = new Date(today + 'T12:00:00')
    return (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth())
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Date nav */}
      <div className="flex items-center gap-3 mb-6 w-full">
        <button
          onClick={() => shift(-1)}
          className="p-1.5 border border-border hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </button>

        <div className="flex-1 text-center flex items-center justify-center relative">
          <button
            type="button"
            onClick={() => {
              setCalendarOffset(calcMonthOffset(date))
              setDatePickerOpen(true)
            }}
            className="text-sm font-semibold text-foreground hover:underline underline-offset-4"
          >
            {prettyDate(date)}
          </button>

          {datePickerOpen && (
            <div
              ref={pickerRef}
              className="absolute top-full left-1/2 -translate-x-1/2 mt-3 z-50 w-[760px] border border-border bg-card shadow-2xl rounded-lg flex flex-col"
            >
              <Calendar
                data={calendarStats}
                highFreqDays={journalDates}
                offset={calendarOffset}
                setOffset={setCalendarOffset}
                selectedDate={date}
                disableFutureDays
                onSelectDate={(picked) => {
                  setDate(picked)
                  setDatePickerOpen(false)
                }}
              />
            </div>
          )}
        </div>

        {!isToday && (
          <button
            onClick={() => setDate(today)}
            className="text-[10px] font-bold uppercase tracking-widest text-primary border border-primary/40 px-2 py-0.5 hover:bg-primary/10 transition-colors"
          >
            Today
          </button>
        )}

        <button
          onClick={() => shift(1)}
          disabled={isToday}
          className="p-1.5 border border-border hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Body */}
      <div className="grid grid-cols-[0.9fr_7.8fr_1.3fr] gap-5 w-full items-start">
        {/* Left rail: search + recent journals */}
        <div className="border border-border bg-card p-4 flex flex-col self-start max-h-[72vh]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Journal</p>
            <button
              onClick={() => setTrashOpen(true)}
              title="View trash"
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search input */}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search notes…"
              className="w-full bg-muted/20 border border-border pl-7 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
            />
            {searchQ && (
              <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Mood filter chips */}
          <div className="flex flex-wrap gap-1 mb-2">
            {moods.map(m => (
              <button
                key={m.value}
                onClick={() => setSearchMood(prev => prev === m.value ? null : m.value)}
                className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors"
                style={searchMood === m.value ? getMoodStyle(m.color) : {}}
              >
                {m.label}
              </button>
            ))}
            <button
              onClick={() => setSearchFlagged(prev => !prev)}
              className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors ${
                searchFlagged ? 'border-amber-400/50 bg-amber-400/10 text-amber-400' : 'border-border text-muted-foreground/50 hover:border-muted-foreground'
              }`}
            >
              Flagged
            </button>
          </div>

          {/* Tag filter chips */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {allTags.map(t => (
                <button
                  key={t}
                  onClick={() => setSearchTag(prev => prev === t ? null : t)}
                  className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors ${
                    searchTag === t
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground/50 hover:border-muted-foreground'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* Results */}
          <div className="flex flex-col gap-1.5 overflow-y-auto pr-1 min-h-0">
            {(() => {
              const entries = isSearching ? searchResults : recentEntries
              if (entries.length === 0) return (
                <p className="text-xs text-muted-foreground/50 py-4 text-center">
                  {isSearching ? 'No results' : 'No journal entries yet'}
                </p>
              )
              return entries.map(j => {
                const moodMeta = j.mood ? moods.find(m => m.value === j.mood) : null
                const selected = j.date === date
                return (
                  <button
                    key={j.id ?? j.date}
                    onClick={() => { setDate(j.date); setDatePickerOpen(false) }}
                    className={`text-left p-2 border border-border hover:bg-accent/50 transition-colors ${
                      selected ? 'bg-primary/5 border-primary/40' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-muted-foreground truncate">{j.date}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {moodMeta && (
                            <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border" style={getMoodStyle(moodMeta.color)}>
                              {moodMeta.label}
                            </span>
                          )}
                          {j.tags?.map(tag => (
                            <span key={tag} className="inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border border-primary/30 bg-primary/10 text-primary">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      {j.flagged && <Flag className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                    </div>
                  </button>
                )
              })
            })()}
          </div>
        </div>

        {/* Middle: journal forms */}
        <div className="flex flex-col gap-4 h-full min-h-0">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Journal Entry</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleFlag}
                disabled={flagMutation.isPending}
                title={form.flagged ? 'Remove flag' : 'Flag for review'}
                className={`p-1.5 transition-colors ${
                  form.flagged ? 'text-amber-400 hover:text-amber-300' : 'text-muted-foreground/60 hover:text-muted-foreground'
                }`}
              >
                <Flag className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!entry?.id || deleteMutation.isPending}
                title="Move to trash"
                className="p-1.5 text-muted-foreground/40 hover:text-rose-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {entry && (
                <button
                  type="button"
                  onClick={() => setViewMode(v => !v)}
                  title={viewMode ? 'Edit entry' : 'View entry'}
                  className="p-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  {viewMode ? <Pencil className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          {viewMode && entry ? (
            /* ── View mode ── */
            <>
              <div className="border border-border bg-card p-4 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pre-Market</p>
                <div className="flex flex-wrap gap-2">
                  {form.mood && (() => { const m = moods.find(x => x.value === form.mood); return m ? (
                    <span className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border" style={getMoodStyle(m.color)}>{m.label}</span>
                  ) : null })()}
                  {form.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border border-primary/30 bg-primary/10 text-primary">{t}</span>
                  ))}
                </div>
                {form.pre_market
                  ? <p className="text-base text-foreground font-mono whitespace-pre-wrap leading-relaxed">{form.pre_market}</p>
                  : <p className="text-xs text-muted-foreground/40 italic">No pre-market notes</p>
                }
              </div>

              <JournalImages date={date} />

              <div className="border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Post-Market Reflection</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-green-400/80">What went well</p>
                    {form.went_well
                      ? <p className="text-base text-foreground font-mono whitespace-pre-wrap leading-relaxed">{form.went_well}</p>
                      : <p className="text-sm text-muted-foreground/40 italic">Nothing noted</p>
                    }
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-red-400/80">To improve</p>
                    {form.to_improve
                      ? <p className="text-base text-foreground font-mono whitespace-pre-wrap leading-relaxed">{form.to_improve}</p>
                      : <p className="text-sm text-muted-foreground/40 italic">Nothing noted</p>
                    }
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* ── Edit mode ── */
            <>
              <div className="border border-border bg-card p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Pre-Market</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {moods.map(m => (
                    <button
                      key={m.value}
                      onClick={() => setForm(f => ({ ...f, mood: f.mood === m.value ? null : m.value }))}
                      className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border transition-colors"
                      style={form.mood === m.value ? getMoodStyle(m.color) : {}}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Tag className="w-3 h-3" /> Tags
                  </p>
                  <TagInput value={form.tags} onChange={tags => setForm(f => ({ ...f, tags }))} suggestions={allTags} />
                </div>
                <textarea
                  value={form.pre_market}
                  onChange={e => setForm(f => ({ ...f, pre_market: e.target.value }))}
                  placeholder="Bias, key levels, news catalysts, plan for the session..."
                  rows={10}
                  className="w-full bg-muted/20 border border-border p-3 text-base text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-primary transition-colors font-mono"
                />
              </div>

              <JournalImages date={date} />

              <div className="border border-border bg-card p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Post-Market Reflection</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-bold text-green-400/80 mb-1.5">What went well</p>
                    <textarea
                      value={form.went_well}
                      onChange={e => setForm(f => ({ ...f, went_well: e.target.value }))}
                      placeholder="Good entries, discipline, pattern recognition..."
                      rows={9}
                      className="w-full bg-muted/20 border border-border p-3 text-base text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-green-500/50 transition-colors font-mono"
                    />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-red-400/80 mb-1.5">To improve</p>
                    <textarea
                      value={form.to_improve}
                      onChange={e => setForm(f => ({ ...f, to_improve: e.target.value }))}
                      placeholder="Mistakes, emotional triggers, missed setups..."
                      rows={9}
                      className="w-full bg-muted/20 border border-border p-3 text-base text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-red-500/50 transition-colors font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={mutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saved ? 'Saved!' : mutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right: trades for the day */}
        <div className="border border-border bg-card p-4 self-start flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
              Trades &middot; {dayTrades.length}
            </p>
            {dayTrades.length > 0 && (
              <span className={`text-xs font-bold ${dayPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {dollar(dayPnl)}
              </span>
            )}
          </div>

          {dayTrades.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 py-6 text-center">No trades on this day</p>
          ) : (
            <div className="flex flex-col gap-2 overflow-y-auto pr-1 max-h-[72vh]">
              {dayTrades.map(t => (
                <button
                  key={t.id}
                  onClick={() => setChartTrade(t)}
                  title="View Chart"
                  className="text-left p-3 border border-border hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-foreground">{t.ticker}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 font-bold ${
                        t.option_type === 'Call'
                          ? 'bg-green-400/10 text-green-400'
                          : 'bg-red-400/10 text-red-400'
                      }`}>
                        {t.option_type === 'Call' ? 'C' : 'P'} {t.strike}
                      </span>
                    </div>
                    <span className={`text-xs font-bold shrink-0 ${t.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {dollar(t.total_pnl)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{t.time}</span>
                    {t.strategy && <span className="text-muted-foreground/60">{t.strategy}</span>}
                    <span className={`ml-auto ${t.status === 'closed' ? 'text-muted-foreground/60' : 'text-amber-400'}`}>
                      {t.status}
                    </span>
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {chartTrade && (
        <TradeChart trade={chartTrade} onClose={() => setChartTrade(null)} />
      )}

      {trashOpen && (
        <JournalTrash
          onClose={() => setTrashOpen(false)}
          onRestore={() => setTrashOpen(false)}
        />
      )}
    </div>
  )
}
