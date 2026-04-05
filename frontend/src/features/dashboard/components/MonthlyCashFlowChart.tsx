import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MetricsResponse } from '@/lib/types'
import { cn } from '@/lib/cn'
import { theme } from '@/lib/theme'

type MonthlyCashFlowChartProps = {
  metrics: MetricsResponse
  className?: string
}

export function MonthlyCashFlowChart({
  metrics,
  className,
}: MonthlyCashFlowChartProps) {
  const data =
    metrics.cashflow_history?.map((row) => ({
      name: row.label,
      Inflow: row.income,
      Outflow: row.expenses,
    })) ?? [
      {
        name: '—',
        Inflow: metrics.monthly_cashflow.income,
        Outflow: metrics.monthly_cashflow.expenses,
      },
    ]

  const period =
    metrics.cashflow_period_label ?? 'Last six months'

  const { chart } = theme

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
      </header>
      <div className="min-h-[280px] w-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <defs>
              <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
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
              domain={[0, 8000]}
              tick={{ fill: chart.tick, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                typeof v === 'number' ? `$${v / 1000}k` : String(v)
              }
            />
            <Tooltip
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
              filter="url(#glow-green)"
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
              filter="url(#glow-blue)"
              dot={{ r: 4, fill: chart.outflow, strokeWidth: 0 }}
              activeDot={{
                r: 6,
                stroke: chart.outflow,
                strokeWidth: 2,
                fill: chart.dotFill,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
