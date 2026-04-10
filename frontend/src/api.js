const BASE = '/api'

function detailToMessage(detail) {
  if (detail == null) return null
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail))
    return detail.map((e) => e.msg || JSON.stringify(e)).join(' ')
  if (typeof detail === 'object' && detail.msg) return detail.msg
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detailToMessage(err.detail) || 'Request failed')
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Trades ────────────────────────────────────────────────────────────────────
export const getTrades = (status, accountId, sessionEnd) => {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (accountId != null) params.set('account_id', accountId)
  if (sessionEnd) params.set('session_end', sessionEnd)
  const qs = params.toString()
  return request('GET', `/trades${qs ? `?${qs}` : ''}`)
}

export const getTrade = (id) => request('GET', `/trades/${id}`)

export const createTrade = (payload) => request('POST', '/trades', payload)

export const updateTrade = (id, payload) =>
  request('PATCH', `/trades/${id}`, payload)

export const deleteTrade = (id) => request('DELETE', `/trades/${id}`)

export const getDeletedTrades = (accountId) => {
  const qs = accountId != null ? `?account_id=${accountId}` : ''
  return request('GET', `/trades/deleted${qs}`)
}

export const restoreTrade = (id) => request('PATCH', `/trades/${id}/restore`)

export const permanentDeleteTrade = (id) => request('DELETE', `/trades/${id}/permanent`)

// ── Exits ─────────────────────────────────────────────────────────────────────
export const addExit = (payload) => request('POST', '/exits', payload)

export const updateExit = (id, payload) => request('PATCH', `/exits/${id}`, payload)

export const deleteExit = (id) => request('DELETE', `/exits/${id}`)

// ── Stats ─────────────────────────────────────────────────────────────────────
export const getOverviewStats = (strategy, accountId, overtradeMultiplier) => {
  const params = new URLSearchParams()
  if (strategy) params.set('strategy', strategy)
  if (accountId != null) params.set('account_id', accountId)
  if (overtradeMultiplier != null) params.set('overtrade_multiplier', overtradeMultiplier)
  const qs = params.toString()
  return request('GET', `/stats/overview${qs ? `?${qs}` : ''}`)
}

export const getCalendarStats = (accountId) => {
  const qs = accountId != null ? `?account_id=${accountId}` : ''
  return request('GET', `/stats/calendar${qs}`)
}

export const getStrategies = (accountId) => {
  const qs = accountId != null ? `?account_id=${accountId}` : ''
  return request('GET', `/stats/strategies${qs}`)
}

// ── Accounts ──────────────────────────────────────────────────────────────────
export const getAccounts = () => request('GET', '/accounts')

export const createAccount = (name) => request('POST', '/accounts', { name })

export const renameAccount = (id, name) => request('PATCH', `/accounts/${id}`, { name })

export const deleteAccount = (id, action, to) => {
  const params = new URLSearchParams({ action })
  if (to != null) params.set('to', to)
  return request('DELETE', `/accounts/${id}?${params}`)
}

// ── Journal ───────────────────────────────────────────────────────────────────
export const getJournalEntry = (date, accountId) => {
  const params = new URLSearchParams({ date })
  if (accountId != null) params.set('account_id', accountId)
  return request('GET', `/journal?${params}`)
}

export const getJournalDates = (accountId) => {
  const qs = accountId != null ? `?account_id=${accountId}` : ''
  return request('GET', `/journal/dates${qs}`)
}

export const upsertJournalEntry = (payload) => request('PUT', '/journal', payload)

export const searchJournalEntries = ({ q, mood, flagged, accountId } = {}) => {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (mood) params.set('mood', mood)
  if (flagged != null) params.set('flagged', flagged ? '1' : '0')
  if (accountId != null) params.set('account_id', accountId)
  const qs = params.toString()
  return request('GET', `/journal/search${qs ? `?${qs}` : ''}`)
}

export const getJournalImages = (date, accountId) => {
  const params = new URLSearchParams({ date })
  if (accountId != null) params.set('account_id', accountId)
  return request('GET', `/journal/images?${params}`)
}

export async function uploadJournalImage(date, accountId, file) {
  const params = new URLSearchParams({ date })
  if (accountId != null) params.set('account_id', accountId)
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/journal/images?${params}`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detailToMessage(err.detail) || 'Upload failed')
  }
  return res.json()
}

export const deleteJournalImage = (id) => request('DELETE', `/journal/images/${id}`)

export const deleteJournalEntry = (id) => request('DELETE', `/journal/${id}`)

export const getDeletedJournalEntries = (accountId) => {
  const qs = accountId != null ? `?account_id=${accountId}` : ''
  return request('GET', `/journal/deleted${qs}`)
}

export const restoreJournalEntry = (id) => request('PATCH', `/journal/${id}/restore`)

export const permanentDeleteJournalEntry = (id) => request('DELETE', `/journal/${id}/permanent`)

// ── Charts ────────────────────────────────────────────────────────────────────
export const getChartData = (ticker, start, end) =>
  request('GET', `/charts/data?ticker=${encodeURIComponent(ticker)}&start=${start}&end=${end}`)

export const deleteChartDay = (ticker, date) =>
  request('DELETE', `/charts/data/day?ticker=${encodeURIComponent(ticker)}&date=${encodeURIComponent(date)}`)

export const getAvailableCharts = () => request('GET', '/charts/available')

export const getYahooFallback = (ticker, start, end) =>
  request('GET', `/charts/yahoo/${encodeURIComponent(ticker)}?start=${start}&end=${end}`)

export const saveYahooDay = (ticker, date) =>
  request('POST', `/charts/yahoo/save-day?ticker=${encodeURIComponent(ticker)}&date=${encodeURIComponent(date)}`)

export async function uploadChartCsv(file, ticker) {
  const form = new FormData()
  form.append('file', file)
  if (ticker) form.append('ticker', ticker)
  const res = await fetch('/api/charts/upload', { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detailToMessage(err.detail) || 'Upload failed')
  }
  return res.json()
}
