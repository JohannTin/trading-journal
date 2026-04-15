const KEY = 'app-settings'

export const MOOD_COLORS = [
  { id: 'green',  label: 'Green',  swatch: '#22c55e', border: 'rgba(34,197,94,0.45)',   bg: 'rgba(34,197,94,0.12)',   text: '#4ade80' },
  { id: 'blue',   label: 'Blue',   swatch: '#3b82f6', border: 'rgba(59,130,246,0.45)',  bg: 'rgba(59,130,246,0.12)',  text: '#60a5fa' },
  { id: 'yellow', label: 'Yellow', swatch: '#eab308', border: 'rgba(234,179,8,0.45)',   bg: 'rgba(234,179,8,0.12)',   text: '#facc15' },
  { id: 'orange', label: 'Orange', swatch: '#f97316', border: 'rgba(249,115,22,0.45)',  bg: 'rgba(249,115,22,0.12)',  text: '#fb923c' },
  { id: 'red',    label: 'Red',    swatch: '#ef4444', border: 'rgba(239,68,68,0.45)',   bg: 'rgba(239,68,68,0.12)',   text: '#f87171' },
  { id: 'purple', label: 'Purple', swatch: '#a855f7', border: 'rgba(168,85,247,0.45)',  bg: 'rgba(168,85,247,0.12)',  text: '#c084fc' },
  { id: 'pink',   label: 'Pink',   swatch: '#ec4899', border: 'rgba(236,72,153,0.45)',  bg: 'rgba(236,72,153,0.12)',  text: '#f472b6' },
  { id: 'cyan',   label: 'Cyan',   swatch: '#06b6d4', border: 'rgba(6,182,212,0.45)',   bg: 'rgba(6,182,212,0.12)',   text: '#22d3ee' },
]

export function getMoodStyle(colorId) {
  const c = MOOD_COLORS.find(c => c.id === colorId) ?? MOOD_COLORS[0]
  return { borderColor: c.border, backgroundColor: c.bg, color: c.text }
}

export const DEFAULT_MOODS = [
  { value: 'focused',    label: 'Focused',    color: 'green'  },
  { value: 'hesitant',   label: 'Hesitant',   color: 'blue'   },
  { value: 'distracted', label: 'Distracted', color: 'yellow' },
  { value: 'fomo',       label: 'FOMO',       color: 'orange' },
  { value: 'revenge',    label: 'Revenge',    color: 'red'    },
]

export const DEFAULTS = {
  tradingStart:          '09:30',
  tradingEnd:            '15:30',
  overtradingMultiplier: 1.5,
  processWinThreshold:   30,
  processMaeThreshold:   30,
  accountBalance:        0,
  dailyRiskMode:         'pct',   // 'pct' | 'fixed'
  dailyRiskPct:          5,
  dailyRiskFixed:        500,
  dailyTargetMode:       'pct',   // 'pct' | 'fixed'
  dailyTargetPct:        5,
  dailyTargetFixed:      500,
  moods:                 DEFAULT_MOODS,
  fontSize:              110,     // percentage applied to html element
}

export function applyFontSize(pct) {
  document.documentElement.style.fontSize = `${pct}%`
}

export function getAppSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { ...DEFAULTS, ...stored, moods: stored.moods ?? DEFAULT_MOODS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAppSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s))
}
