import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MetricsResponse } from '@/lib/types'
import { cn } from '@/lib/cn'
import { monthStartMsFromCashflowLabel } from '@/lib/dashboardSpending'
import { theme } from '@/lib/theme'

type CashflowChartRow = {
  name: string
  month_start_ms: number
  Inflow: number
  Outflow: number
}

type MonthlyCashFlowChartProps = {
  metrics: MetricsResponse
  /** `cashflow_history[].label` for the focused month; null = latest month on the axis. */
  selectedMonthLabel: string | null
  onSelectCashflowMonth: (monthLabel: string) => void
  className?: string
}

function useObservedSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      const width = Math.round(r.width)
      const height = Math.round(r.height)
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      )
    }
    read()
    const raf = requestAnimationFrame(() => read())
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])
  return { ref, width: size.width, height: size.height }
}

export function MonthlyCashFlowChart({
  metrics,
  selectedMonthLabel,
  onSelectCashflowMonth,
  className,
}: MonthlyCashFlowChartProps) {
  const { ref, width, height } = useObservedSize<HTMLDivElement>()
  const filterSuffix = useId().replaceAll(':', '')
  const glowGreenId = `glow-green-${filterSuffix}`
  const glowBlueId = `glow-blue-${filterSuffix}`

  const fallbackMonthStart = useMemo(() => {
    const d = new Date()
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)
  }, [])

  const data: CashflowChartRow[] = useMemo(() => {
    const hist = metrics.cashflow_history
    if (hist?.length) {
      return hist.map((row) => ({
        name: row.label,
        month_start_ms:
          row.month_start_ms ??
          monthStartMsFromCashflowLabel(row.label) ??
          fallbackMonthStart,
        Inflow: row.income,
        Outflow: row.expenses,
      }))
    }
    return [
      {
        name: '—',
        month_start_ms: fallbackMonthStart,
        Inflow: metrics.monthly_cashflow.income,
        Outflow: metrics.monthly_cashflow.expenses,
      },
    ]
  }, [metrics, fallbackMonthStart])

  const yMax = useMemo(() => {
    let m = 0
    for (const row of data) {
      m = Math.max(
        m,
        Number.isFinite(row.Inflow) ? row.Inflow : 0,
        Number.isFinite(row.Outflow) ? row.Outflow : 0,
      )
    }
    if (m === 0) return 1
    return m * 1.08
  }, [data])

  const period =
    metrics.cashflow_period_label ?? 'Cash flow'

  const { chart } = theme
  const chartReady = width > 0 && height > 0

  /** Tooltip `defaultIndex` + category pane when nothing explicitly selected */
  const defaultMonthLabel = data.at(-1)?.name ?? null

  const tooltipDefaultIndex = useMemo(() => {
    const label = selectedMonthLabel ?? defaultMonthLabel
    if (!label) return undefined
    const i = data.findIndex((d) => d.name === label)
    return i >= 0 ? i : undefined
  }, [data, selectedMonthLabel, defaultMonthLabel])

  return (
    <section
      className={cn(
        'glass-panel flex h-full flex-col rounded-3xl p-6 text-left',
        className,
      )}
    >
      <header className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-white">
          Monthly Cash Flow
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{period}</p>
        <p className="mt-1 text-xs text-zinc-600">
          Click the chart on a month to show spending by category.
        </p>
      </header>
      <div
        ref={ref}
        className="min-h-[280px] w-full min-w-0 flex-1 [&_.recharts-tooltip-cursor]:pointer-events-none"
        aria-busy={!chartReady}
      >
        {chartReady ? (
          <LineChart
            width={width}
            height={height}
            data={data}
            margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
            onClick={(state) => {
              const label = state.activeLabel
              if (label === undefined || label === null || label === '') return
              onSelectCashflowMonth(String(label))
            }}
          >
            <defs>
              <filter
                id={glowGreenId}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter
                id={glowBlueId}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chart.grid}
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: chart.tick, fontSize: 11 }}
              axisLine={{ stroke: chart.axisLine }}
              tickLine={false}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fill: chart.tick, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                typeof v === 'number' ? `$${v / 1000}k` : String(v)
              }
            />
            <Tooltip
              shared
              trigger="click"
              defaultIndex={tooltipDefaultIndex}
              cursor={{
                stroke: 'rgba(255, 255, 255, 0.35)',
                strokeWidth: 1,
                fill: 'rgba(255, 255, 255, 0.06)',
              }}
              formatter={(value, name) => {
                const n = typeof value === 'number' ? value : Number(value)
                const label =
                  name === 'Inflow' ? 'Inflow (emerald)' : 'Outflow (sky)'
                return [
                  n.toLocaleString(undefined, {
                    style: 'currency',
                    currency: 'USD',
                  }),
                  label,
                ]
              }}
              contentStyle={{
                background: chart.tooltipBg,
                border: `1px solid ${chart.tooltipBorder}`,
                borderRadius: '12px',
                color: chart.tooltipText,
                boxShadow: chart.tooltipShadow,
              }}
              labelStyle={{ color: chart.tooltipMuted }}
            />
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(value) => (
                <span className="text-sm text-zinc-400">{value}</span>
              )}
            />
            <Line
              type="monotone"
              dataKey="Inflow"
              name="Inflow"
              stroke={chart.inflow}
              strokeWidth={3}
              filter={`url(#${glowGreenId})`}
              dot={{ r: 4, fill: chart.inflow, strokeWidth: 0 }}
              activeDot={{
                r: 6,
                stroke: chart.inflow,
                strokeWidth: 2,
                fill: chart.dotFill,
              }}
            />
            <Line
              type="monotone"
              dataKey="Outflow"
              name="Outflow"
              stroke={chart.outflow}
              strokeWidth={3}
              filter={`url(#${glowBlueId})`}
              dot={{ r: 4, fill: chart.outflow, strokeWidth: 0 }}
              activeDot={{
                r: 6,
                stroke: chart.outflow,
                strokeWidth: 2,
                fill: chart.dotFill,
              }}
            />
          </LineChart>
        ) : null}
      </div>
    </section>
  )
}
