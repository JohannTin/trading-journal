import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOverviewStats, getStrategies, getTrades } from '../api'
import { useAccount } from '../AccountContext'
import { getAppSettings } from '../appSettings'
import { AlertTriangle } from 'lucide-react'

function InputRow({ label, value, onChange, hint }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
        <span>{label}</span>
        {hint && (
          <span
            title={hint}
            className="text-[10px] font-mono text-muted-foreground/70 border border-border px-1 leading-none"
          >
            ?
          </span>
        )}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
        <input
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-border bg-muted/30 py-2.5 pl-7 pr-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </div>
    </div>
  )
}

function StatRow({ label, value, color = 'text-foreground' }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-mono font-semibold ${color}`}>{value}</span>
    </div>
  )
}

const KELLY_SELECTED_CLS = {
  'text-amber-400':  'border-amber-400 bg-amber-500/10',
  'text-emerald-400':'border-emerald-400 bg-emerald-500/10',
  'text-sky-400':    'border-sky-400 bg-sky-500/10',
}

function KellyBand({ label, pct, dollars, contracts, color, borderColor, isSelected, onClick, upside, downside, recommended }) {
  const selectedCls = KELLY_SELECTED_CLS[color] ?? borderColor
  return (
    <button
      onClick={onClick}
      className={`border p-4 flex flex-col gap-3 w-full text-left transition-colors cursor-pointer ${
        isSelected ? selectedCls : `${borderColor} hover:brightness-125`
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold uppercase tracking-wide ${color}`}>{label}</span>
          {recommended && (
            <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5">
              Recommended
            </span>
          )}
        </div>
        <span className={`font-mono text-2xl font-medium ${color}`}>
          {pct >= 0 ? pct.toFixed(1) : '—'}%
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/30 px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Capital to risk</p>
          <p className={`font-mono text-base font-bold ${color}`}>
            {dollars != null && dollars >= 0
              ? `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
              : '—'}
          </p>
        </div>
        <div className="bg-muted/30 px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Contracts</p>
          <p className={`font-mono text-base font-bold ${color}`}>
            {contracts != null && contracts >= 0 ? contracts : '—'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div className="bg-emerald-500/10 px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Upside</p>
          <p className="font-mono text-base font-bold text-emerald-400">
            {upside != null ? `+$${upside.toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="bg-rose-500/10 px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Downside</p>
          <p className="font-mono text-base font-bold text-rose-400">
            {downside != null ? `-$${downside.toFixed(2)}` : '—'}
          </p>
        </div>
      </div>
    </button>
  )
}

const STOP_PCTS   = [-10, -20, -25, -30, -50, -75, -100]
const TARGET_PCTS = [10, 20, 25, 30, 50, 75, 100]

function PriceLevel({ pct, price, amount, isSelected, onClick }) {
  const isLoss = pct < 0
  const color  = isLoss ? 'text-rose-400' : 'text-emerald-400'
  const bg     = isSelected
    ? isLoss ? 'bg-rose-500/10 border-rose-400' : 'bg-emerald-500/10 border-emerald-400'
    : 'bg-muted/20 border-border hover:border-muted-foreground/40'

  return (
    <button
      onClick={onClick}
      className={`w-full border px-3 py-2.5 flex items-center justify-between transition-colors cursor-pointer ${bg}`}
    >
      <div className="flex items-center gap-2">
        <span className={`font-mono text-sm font-bold ${color}`}>
          {pct > 0 ? '+' : ''}{pct}%
        </span>
        {isSelected && (
          <span className={`text-[9px] font-bold uppercase tracking-wider ${isLoss ? 'text-rose-400' : 'text-emerald-400'}`}>
            {isLoss ? 'Stop' : 'Target'}
          </span>
        )}
      </div>
      <span className={`font-mono text-sm font-semibold ${price != null ? color : 'text-muted-foreground'}`}>
        {price != null ? `$${price.toFixed(2)}` : '—'}
        <span className="text-muted-foreground"> / </span>
        <span className={amount != null ? color : 'text-muted-foreground'}>
          {amount != null ? `${amount >= 0 ? '+' : '-'}$${Math.abs(amount).toFixed(2)}` : '—'}
        </span>
      </span>
    </button>
  )
}

export default function KellyCalculator() {
  const [balance, setBalance]           = useState(() => localStorage.getItem('kelly_balance') || '')
  const [contractPrice, setContractPrice] = useState(() => localStorage.getItem('kelly_contract_price') || '')
  const [selectedStop, setSelectedStop]     = useState(-30)
  const [selectedTarget, setSelectedTarget] = useState(30)
  const [customStop, setCustomStop]         = useState('')
  const [customTarget, setCustomTarget]     = useState('')
  const [selectedKelly, setSelectedKelly]   = useState('half')
  const [dailyTarget, setDailyTarget]   = useState(() => localStorage.getItem('kelly_daily_target') || '')
  const [dailyMaxLoss, setDailyMaxLoss] = useState(() => localStorage.getItem('kelly_daily_max_loss') || '')
  const [contractCount, setContractCount] = useState(() => localStorage.getItem('kelly_contract_count') || '1')
  const [dailyTargetPct, setDailyTargetPct] = useState(() => localStorage.getItem('kelly_daily_target_pct') || '')
  const [dailyMaxLossPct, setDailyMaxLossPct] = useState(() => localStorage.getItem('kelly_daily_max_loss_pct') || '')
  const [targetInputMode, setTargetInputMode] = useState('amount')
  const [lossInputMode, setLossInputMode] = useState('amount')
  const [selectedStrategy, setSelectedStrategy] = useState(null)
  const [edgeMode, setEdgeMode] = useState('actual') // 'actual' | 'mfe'

  const { accountId } = useAccount()

  useEffect(() => { localStorage.setItem('kelly_balance', balance) }, [balance])
  useEffect(() => { localStorage.setItem('kelly_contract_price', contractPrice) }, [contractPrice])
  useEffect(() => { localStorage.setItem('kelly_daily_target', dailyTarget) }, [dailyTarget])
  useEffect(() => { localStorage.setItem('kelly_daily_max_loss', dailyMaxLoss) }, [dailyMaxLoss])
  useEffect(() => { localStorage.setItem('kelly_contract_count', contractCount) }, [contractCount])
  useEffect(() => { localStorage.setItem('kelly_daily_target_pct', dailyTargetPct) }, [dailyTargetPct])
  useEffect(() => { localStorage.setItem('kelly_daily_max_loss_pct', dailyMaxLossPct) }, [dailyMaxLossPct])

  const { data: strategies = [] } = useQuery({
    queryKey: ['strategies', accountId],
    queryFn: () => getStrategies(accountId),
  })

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats-overview', selectedStrategy, accountId],
    queryFn: () => getOverviewStats(selectedStrategy, accountId),
  })

  const { data: allTrades = [] } = useQuery({
    queryKey: ['trades', null, accountId, null],
    queryFn: () => getTrades(null, accountId, null),
  })

  const bal  = parseFloat(balance) || 0
  const cost = (parseFloat(contractPrice) || 0) * 100

  const { processWinThreshold = 30, processMaeThreshold = 30 } = getAppSettings()

  const mfeStats = useMemo(() => {
    const closed = allTrades.filter(t =>
      t.status === 'closed' &&
      (!selectedStrategy || t.strategy === selectedStrategy)
    )
    const withData = closed.filter(t => t.exits?.some(e => e.mfe != null))
    if (!withData.length) return null

    const wins   = withData.filter(t => t.exits.filter(e => e.mfe != null).at(-1).mfe >= processWinThreshold)
    const losses = withData.filter(t => t.exits.filter(e => e.mfe != null).at(-1).mfe <  processWinThreshold)

    const adjWinRate = wins.length / withData.length

    const adjAvgWin = wins.length > 0
      ? wins.reduce((s, t) => {
          const mfe = t.exits.filter(e => e.mfe != null).at(-1).mfe
          return s + t.fill * (mfe / 100) * 100 * t.qty
        }, 0) / wins.length
      : 0

    const adjAvgLoss = losses.length > 0
      ? losses.reduce((s, t) => {
          const mae = t.exits.filter(e => e.mae != null).at(-1)?.mae ?? 0
          const stopPct = Math.min(Math.abs(mae), processMaeThreshold)
          return s + t.fill * (stopPct / 100) * 100 * t.qty
        }, 0) / losses.length
      : 0

    const rr    = adjAvgLoss > 0 ? adjAvgWin / adjAvgLoss : 0
    const kelly = rr > 0 ? adjWinRate - (1 - adjWinRate) / rr : null

    return { winRate: adjWinRate, avgWin: adjAvgWin, avgLoss: adjAvgLoss, rr, kelly, count: withData.length }
  }, [allTrades, selectedStrategy, processWinThreshold, processMaeThreshold])

  const isMfe   = edgeMode === 'mfe' && mfeStats != null
  const winRate = isMfe ? mfeStats.winRate       : (stats?.win_rate ?? 0) / 100
  const avgWin  = isMfe ? mfeStats.avgWin        : (stats?.avg_win  ?? 0)
  const avgLoss = isMfe ? mfeStats.avgLoss       : Math.abs(stats?.avg_loss ?? 0)
  const historicalRR = avgLoss > 0 ? avgWin / avgLoss : 0

  const customRR = selectedTarget / Math.abs(selectedStop)
  const rr       = customRR

  const kelly = rr > 0 ? winRate - (1 - winRate) / rr : null

  const calcDollars   = (pct) => (kelly == null || kelly <= 0 || bal <= 0) ? null : Math.max(0, bal * pct)
  const calcContracts = (dollars) => (dollars == null || dollars <= 0 || cost <= 0) ? null : Math.max(0, Math.floor(dollars / cost))

  const fullDollars    = calcDollars(kelly)
  const halfDollars    = calcDollars(kelly != null ? kelly * 0.5 : null)
  const quarterDollars = calcDollars(kelly != null ? kelly * 0.25 : null)

  const hasData      = stats?.closed_count > 0
  const negativeEdge = kelly != null && kelly <= 0

  const cp = parseFloat(contractPrice) || null
  const cc = Math.max(1, parseInt(contractCount) || 1)
  const priceAt = (pct) => cp != null ? cp * (1 + pct / 100) : null
  const amountAt = (pct) => cp != null ? cp * 100 * cc * (pct / 100) : null

  // Upside/downside $ per band
  const upsideFor = (contracts) => (contracts && cp) ? contracts * cp * 100 * (selectedTarget / 100) : null
  const downsideFor = (contracts) => (contracts && cp) ? contracts * cp * 100 * (Math.abs(selectedStop) / 100) : null

  const fullContracts    = calcContracts(fullDollars)
  const halfContracts    = calcContracts(halfDollars)
  const quarterContracts = calcContracts(quarterDollars)

  const kellyContractsMap = { full: fullContracts, half: halfContracts, quarter: quarterContracts }
  const selectedContracts = kellyContractsMap[selectedKelly]

  useEffect(() => {
    if (bal <= 0) return
    if (targetInputMode === 'amount' && dailyTarget !== '') {
      const dollars = parseFloat(dailyTarget)
      if (!isNaN(dollars)) setDailyTargetPct(((dollars / bal) * 100).toFixed(2))
    } else if (targetInputMode === 'pct' && dailyTargetPct !== '') {
      const pct = parseFloat(dailyTargetPct)
      if (!isNaN(pct)) setDailyTarget(((bal * pct) / 100).toFixed(2))
    }
  }, [bal, targetInputMode])

  useEffect(() => {
    if (bal <= 0) return
    if (lossInputMode === 'amount' && dailyMaxLoss !== '') {
      const dollars = parseFloat(dailyMaxLoss)
      if (!isNaN(dollars)) setDailyMaxLossPct(((dollars / bal) * 100).toFixed(2))
    } else if (lossInputMode === 'pct' && dailyMaxLossPct !== '') {
      const pct = parseFloat(dailyMaxLossPct)
      if (!isNaN(pct)) setDailyMaxLoss(((bal * pct) / 100).toFixed(2))
    }
  }, [bal, lossInputMode])

  // Daily limits — based on selected Kelly
  const profitPerWin    = upsideFor(selectedContracts)
  const lossPerTrade    = downsideFor(selectedContracts)
  const dt              = parseFloat(dailyTarget) || null
  const dml             = parseFloat(dailyMaxLoss) || null
  const winsToTarget    = (dt && profitPerWin) ? Math.ceil(dt / profitPerWin) : null
  const maxLosingTrades = (dml && lossPerTrade) ? Math.floor(dml / lossPerTrade) : null

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-7 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <button
            onClick={() => setEdgeMode(m => m === 'actual' ? 'mfe' : 'actual')}
            disabled={mfeStats == null}
            title={mfeStats == null ? 'No MFE/MAE data — upload chart CSVs for your trades first' : undefined}
            className={`px-4 py-1.5 text-xs font-bold uppercase tracking-widest border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isMfe
                ? 'bg-sky-500/15 text-sky-400 border-sky-500/40 hover:bg-sky-500/25'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {isMfe ? '← Actual Edge' : 'MFE · MAE Edge'}
          </button>

          {/* Strategy filter */}
          {strategies.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              <button
                onClick={() => setSelectedStrategy(null)}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors border ${
                  selectedStrategy === null
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                All Strategies
              </button>
              {strategies.map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedStrategy(selectedStrategy === s ? null : s)}
                  className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors border ${
                    selectedStrategy === s
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {!hasData && !isLoading && (
          <div className="flex items-start gap-3 border border-amber-500/25 bg-amber-500/5 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-300">
              No closed trades yet. Log and close some trades to calculate your edge.
            </p>
          </div>
        )}

        {negativeEdge && hasData && (
          <div className="flex items-start gap-3 border border-rose-500/25 bg-rose-500/5 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-rose-300">Negative edge detected</p>
              <p className="text-xs text-rose-400/70 mt-0.5">
                Your current win rate and R:R suggest you should not be sizing up. Kelly recommends
                not trading this system until your edge improves.
              </p>
            </div>
          </div>
        )}

        {/* Main two-column layout */}
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-5 items-start">

          {/* LEFT — inputs & edge stats */}
          <div className="space-y-5">
            {/* Account Settings */}
            <div className="border border-border bg-card p-5 space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Account Settings</p>
              <InputRow
                label="Account Balance"
                value={balance}
                onChange={setBalance}
                hint="Your current tradeable capital"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
                  <span>Contract Price</span>
                  <span
                    title="Used to calculate price levels and $ moves below"
                    className="text-[10px] font-mono text-muted-foreground/70 border border-border px-1 leading-none"
                  >
                    ?
                  </span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={contractPrice}
                    onChange={(e) => setContractPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-border bg-muted/30 py-2.5 pl-7 pr-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
                  <span>Contracts</span>
                  <span
                    title="Linked with Contract Price for per-level $ P/L"
                    className="text-[10px] font-mono text-muted-foreground/70 border border-border px-1 leading-none"
                  >
                    ?
                  </span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={contractCount}
                  onChange={(e) => setContractCount(e.target.value)}
                  className="w-full border border-border bg-muted/30 py-2.5 px-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            {/* Daily Limits */}
            <div className="border border-border bg-card p-5 space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Daily Limits</p>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Profit Target
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={dailyTarget}
                      onChange={(e) => {
                        const v = e.target.value
                        setTargetInputMode('amount')
                        setDailyTarget(v)
                        const n = parseFloat(v)
                        setDailyTargetPct(!isNaN(n) && bal > 0 ? ((n / bal) * 100).toFixed(2) : '')
                      }}
                      placeholder="0.00"
                      className="w-full border border-border bg-muted/30 py-2.5 pl-7 pr-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">%</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={dailyTargetPct}
                      onChange={(e) => {
                        const v = e.target.value
                        setTargetInputMode('pct')
                        setDailyTargetPct(v)
                        const n = parseFloat(v)
                        setDailyTarget(!isNaN(n) && bal > 0 ? ((bal * n) / 100).toFixed(2) : '')
                      }}
                      placeholder="0.00"
                      className="w-full border border-border bg-muted/30 py-2.5 pl-7 pr-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Max Loss
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={dailyMaxLoss}
                      onChange={(e) => {
                        const v = e.target.value
                        setLossInputMode('amount')
                        setDailyMaxLoss(v)
                        const n = parseFloat(v)
                        setDailyMaxLossPct(!isNaN(n) && bal > 0 ? ((n / bal) * 100).toFixed(2) : '')
                      }}
                      placeholder="0.00"
                      className="w-full border border-border bg-muted/30 py-2.5 pl-7 pr-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">%</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={dailyMaxLossPct}
                      onChange={(e) => {
                        const v = e.target.value
                        setLossInputMode('pct')
                        setDailyMaxLossPct(v)
                        const n = parseFloat(v)
                        setDailyMaxLoss(!isNaN(n) && bal > 0 ? ((bal * n) / 100).toFixed(2) : '')
                      }}
                      placeholder="0.00"
                      className="w-full border border-border bg-muted/30 py-2.5 pl-7 pr-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                </div>
              </div>
              {(profitPerWin || lossPerTrade) && (
                <div className="border-t border-border pt-3 space-y-0">
                  {winsToTarget != null && (
                    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <span className="text-xs text-muted-foreground">Wins to reach target</span>
                      <span className="font-mono text-sm font-semibold text-emerald-400">{winsToTarget}</span>
                    </div>
                  )}
                  {profitPerWin != null && (
                    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <span className="text-xs text-muted-foreground">Profit per win</span>
                      <span className="font-mono text-sm font-semibold text-emerald-400">
                        ${profitPerWin.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {maxLosingTrades != null && (
                    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <span className="text-xs text-muted-foreground">Max losing trades</span>
                      <span className="font-mono text-sm font-semibold text-rose-400">{maxLosingTrades}</span>
                    </div>
                  )}
                  {lossPerTrade != null && (
                    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <span className="text-xs text-muted-foreground">Loss per trade</span>
                      <span className="font-mono text-sm font-semibold text-rose-400">
                        -${lossPerTrade.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Edge stats */}
            <div className="border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  {selectedStrategy ? selectedStrategy : 'Your Edge'}
                </p>
                <span className="font-mono text-xs text-muted-foreground">
                  {isMfe ? mfeStats.count : (stats?.closed_count ?? 0)} closed
                </span>
              </div>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-9 bg-muted animate-pulse" />
                  ))}
                </div>
              ) : (
                <div>
                  <StatRow
                    label={isMfe ? 'Adj. Win Rate' : 'Win Rate'}
                    value={`${(winRate * 100).toFixed(1)}%`}
                    color={winRate >= 0.5 ? 'text-emerald-400' : 'text-rose-500'}
                  />
                  <StatRow
                    label={isMfe ? 'Avg Win (MFE exit)' : 'Avg Win'}
                    value={`+$${avgWin.toFixed(2)}`}
                    color="text-emerald-400"
                  />
                  <StatRow
                    label={isMfe ? 'Avg Loss (MAE stop)' : 'Avg Loss'}
                    value={`-$${avgLoss.toFixed(2)}`}
                    color="text-rose-500"
                  />
                  <StatRow
                    label={isMfe ? 'MFE/MAE R:R' : 'Historical R:R'}
                    value={historicalRR > 0 ? historicalRR.toFixed(2) : '—'}
                    color={historicalRR >= 1 ? 'text-emerald-400' : historicalRR > 0 ? 'text-amber-400' : 'text-muted-foreground'}
                  />
                  <StatRow
                    label={`Selected R:R (${selectedStop}% / +${selectedTarget}%)`}
                    value={customRR.toFixed(2)}
                    color={customRR >= 1 ? 'text-emerald-400' : 'text-amber-400'}
                  />
                  <StatRow
                    label="Full Kelly %"
                    value={kelly != null ? `${(kelly * 100).toFixed(1)}%` : '—'}
                    color={kelly == null ? 'text-muted-foreground' : kelly > 0 ? 'text-primary' : 'text-rose-500'}
                  />
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — outputs */}
          <div className="space-y-5">
            {/* Sizing bands */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Sizing Recommendation</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <KellyBand
                  label="Full Kelly"
                  pct={kelly != null && kelly > 0 ? kelly * 100 : -1}
                  dollars={fullDollars}
                  contracts={fullContracts}
                  color="text-amber-400"
                  borderColor="border-amber-500/25"
                  isSelected={selectedKelly === 'full'}
                  onClick={() => setSelectedKelly('full')}
                  upside={upsideFor(fullContracts)}
                  downside={downsideFor(fullContracts)}
                />
                <KellyBand
                  label="Half Kelly"
                  pct={kelly != null && kelly > 0 ? kelly * 50 : -1}
                  dollars={halfDollars}
                  contracts={halfContracts}
                  color="text-emerald-400"
                  borderColor="border-emerald-500/25"
                  isSelected={selectedKelly === 'half'}
                  onClick={() => setSelectedKelly('half')}
                  upside={upsideFor(halfContracts)}
                  downside={downsideFor(halfContracts)}
                  recommended
                />
                <KellyBand
                  label="Quarter Kelly"
                  pct={kelly != null && kelly > 0 ? kelly * 25 : -1}
                  dollars={quarterDollars}
                  contracts={quarterContracts}
                  color="text-sky-400"
                  borderColor="border-sky-500/25"
                  isSelected={selectedKelly === 'quarter'}
                  onClick={() => setSelectedKelly('quarter')}
                  upside={upsideFor(quarterContracts)}
                  downside={downsideFor(quarterContracts)}
                />
              </div>
            </div>

            {/* Contract price levels */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Contract Price Levels</p>
              <div className="border border-border bg-card p-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-rose-400/70 mb-2">Downside</p>
                    {STOP_PCTS.map((pct) => (
                      <PriceLevel
                        key={pct}
                        pct={pct}
                        price={priceAt(pct)}
                        amount={amountAt(pct)}
                        isSelected={pct === selectedStop && customStop === ''}
                        onClick={() => { setSelectedStop(pct); setCustomStop('') }}
                      />
                    ))}
                    <div className={`relative mt-2 border transition-colors ${
                      customStop !== '' ? 'border-rose-400 bg-rose-500/10' : 'border-border bg-muted/20 hover:border-muted-foreground/40'
                    }`}>
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400/60 text-sm font-mono">%</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Custom"
                        value={customStop}
                        onChange={(e) => {
                          setCustomStop(e.target.value)
                          const n = parseFloat(e.target.value)
                          if (!isNaN(n) && n > 0) setSelectedStop(-n)
                        }}
                        className="w-full bg-transparent py-2 pl-7 pr-3 text-sm font-mono text-rose-400 placeholder:text-muted-foreground/40 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-400/70 mb-2">Upside</p>
                    {TARGET_PCTS.map((pct) => (
                      <PriceLevel
                        key={pct}
                        pct={pct}
                        price={priceAt(pct)}
                        amount={amountAt(pct)}
                        isSelected={pct === selectedTarget && customTarget === ''}
                        onClick={() => { setSelectedTarget(pct); setCustomTarget('') }}
                      />
                    ))}
                    <div className={`relative mt-2 border transition-colors ${
                      customTarget !== '' ? 'border-emerald-400 bg-emerald-500/10' : 'border-border bg-muted/20 hover:border-muted-foreground/40'
                    }`}>
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400/60 text-sm font-mono">%</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Custom"
                        value={customTarget}
                        onChange={(e) => {
                          setCustomTarget(e.target.value)
                          const n = parseFloat(e.target.value)
                          if (!isNaN(n) && n > 0) setSelectedTarget(n)
                        }}
                        className="w-full bg-transparent py-2 pl-7 pr-3 text-sm font-mono text-emerald-400 placeholder:text-muted-foreground/40 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
