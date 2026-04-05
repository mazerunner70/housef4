/**
 * References CSS variables from `src/index.css` (@theme).
 * Use for SVG/Recharts props and runtime style objects where classes are awkward.
 */
export const theme = {
  chart: {
    inflow: 'var(--color-neon-green)',
    outflow: 'var(--color-neon-blue)',
    grid: 'var(--color-chart-grid)',
    axisLine: 'var(--color-chart-axis)',
    tick: 'var(--color-chart-tick)',
    tooltipBg: 'var(--color-tooltip-surface)',
    tooltipBorder: 'var(--color-tooltip-border)',
    tooltipShadow: 'var(--shadow-tooltip)',
    tooltipText: 'var(--color-text-strong)',
    tooltipMuted: 'var(--color-text)',
    dotFill: 'var(--color-chart-dot-fill)',
  },
  categoryGlow: [
    'var(--glow-category-housing)',
    'var(--glow-category-groceries)',
    'var(--glow-category-discretionary)',
    'var(--glow-category-transport)',
    'var(--glow-category-savings)',
  ],
} as const
