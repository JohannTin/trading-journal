const KEY = 'app-timezone'

export const DEFAULT_TZ = 'America/New_York'

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York',    label: 'New York (ET)' },
  { value: 'America/Chicago',     label: 'Chicago (CT)' },
  { value: 'America/Denver',      label: 'Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'America/Toronto',     label: 'Toronto (ET)' },
  { value: 'Europe/London',       label: 'London (GMT/BST)' },
  { value: 'Europe/Frankfurt',    label: 'Frankfurt (CET)' },
  { value: 'Asia/Tokyo',          label: 'Tokyo (JST)' },
  { value: 'Asia/Hong_Kong',      label: 'Hong Kong (HKT)' },
  { value: 'Asia/Singapore',      label: 'Singapore (SGT)' },
  { value: 'Australia/Sydney',    label: 'Sydney (AEST)' },
]

// Returns the current UTC offset string for a timezone, e.g. "UTC+5:30" or "UTC-5"
export function getTzOffset(tz) {
  try {
    const now = new Date()
    const tzMs  = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime()
    const utcMs = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    const diffMin = Math.round((tzMs - utcMs) / 60000)
    const sign = diffMin >= 0 ? '+' : '-'
    const abs  = Math.abs(diffMin)
    const h    = Math.floor(abs / 60)
    const m    = abs % 60
    return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`
  } catch {
    return 'UTC'
  }
}

export function getTimezone() {
  return localStorage.getItem(KEY) || DEFAULT_TZ
}

export function saveTimezone(tz) {
  localStorage.setItem(KEY, tz)
}
