const KEY = 'app-settings'

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
}

export function getAppSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAppSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s))
}
