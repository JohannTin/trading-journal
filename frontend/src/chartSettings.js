const KEY = 'chart-settings'
const DEFAULTS = { marginTop: 0.10, marginBottom: 0.08, rightBars: 10 }

export function getChartSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveChartSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export { DEFAULTS }
