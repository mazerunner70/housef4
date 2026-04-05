import type { MetricsResponse } from '@/lib/types'
import { cn } from '@/lib/cn'

type NetWorthHeroProps = {
  metrics: MetricsResponse
  className?: string
}

function formatNetWorth(n: number) {
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function NetWorthHero({ metrics, className }: NetWorthHeroProps) {
  const pct = metrics.net_worth_change_pct
  const trendLabel =
    pct != null
      ? `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`
      : null

  return (
    <div
      className={cn(
        'glass-panel relative overflow-hidden rounded-3xl p-8',
        className,
      )}
    >
      <div
        className="net-worth-hero-aura pointer-events-none absolute inset-0"
        aria-hidden
      />
      <div className="relative">
        <p className="text-sm font-medium text-zinc-400">Net Worth</p>
        <p className="mt-2 text-4xl font-semibold tracking-tight text-white tabular-nums sm:text-5xl md:text-[3.25rem]">
          {formatNetWorth(metrics.net_worth)}
        </p>
        {trendLabel != null && (
          <p className="mt-3 flex flex-wrap items-baseline gap-2 text-sm">
            <span className="trend-positive-glow inline-flex items-center gap-1 font-semibold text-emerald-400">
              {trendLabel}
              <span aria-hidden>↑</span>
            </span>
            <span className="text-zinc-500">this month</span>
          </p>
        )}
      </div>
    </div>
  )
}
