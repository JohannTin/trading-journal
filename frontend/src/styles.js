/**
 * Master design tokens — import from here instead of hardcoding class strings.
 * All shared classNames, color helpers, and formatting utilities live here.
 */

// ── Layout ────────────────────────────────────────────────────────────────────
export const CARD         = 'border border-border bg-card'
export const PANEL_HEADER = 'px-4 py-3 border-b border-border shrink-0 flex items-center justify-between'

// ── Typography ────────────────────────────────────────────────────────────────
export const PAGE_TITLE    = 'text-sm font-bold uppercase tracking-[0.2em] text-foreground'
export const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground'
export const LABEL         = 'block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5'

// ── Form inputs ───────────────────────────────────────────────────────────────
export const INPUT = [
  'w-full border border-border bg-muted/30 px-3 py-2',
  'text-sm font-mono text-foreground',
  'focus:outline-none focus:border-primary transition-colors',
  'placeholder:text-muted-foreground/40',
].join(' ')

export const SELECT = [
  'border border-border bg-muted/30 px-3 py-1.5',
  'text-xs font-mono text-foreground',
  'focus:outline-none focus:border-primary transition-colors',
].join(' ')

// ── Buttons ───────────────────────────────────────────────────────────────────
export const BTN_PRIMARY = 'bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40'
export const BTN_GHOST   = 'text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
export const BTN_ICON    = 'p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
export const BTN_DANGER  = 'text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors'

// ── Option type badges ────────────────────────────────────────────────────────
export const BADGE_CALL = 'text-[10px] font-bold px-1.5 py-0.5 bg-sky-500/15 text-sky-400'
export const BADGE_PUT  = 'text-[10px] font-bold px-1.5 py-0.5 bg-violet-500/15 text-violet-400'
export function optionBadge(type) {
  return type === 'Call' ? BADGE_CALL : BADGE_PUT
}

// ── P&L colors ────────────────────────────────────────────────────────────────
export const PNL_POS = 'text-emerald-400'
export const PNL_NEG = 'text-rose-500'
export const PNL_NEU = 'text-muted-foreground'
export function pnlColor(val) {
  if (val > 0) return 'text-emerald-400'
  if (val < 0) return 'text-rose-500'
  return 'text-muted-foreground'
}

// ── Formatting helpers ────────────────────────────────────────────────────────
export function fmt(n) {
  const abs = Math.abs(n).toFixed(2)
  return n >= 0 ? `+$${abs}` : `-$${abs}`
}

export function fmtShort(n) {
  const abs = Math.abs(n)
  const str = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}K` : `$${abs.toFixed(0)}`
  return n >= 0 ? `+${str}` : `-${str}`
}
