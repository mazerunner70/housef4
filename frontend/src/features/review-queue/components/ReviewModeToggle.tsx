import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ReviewMode = 'categories' | 'transfers'

type ReviewModeToggleProps = Readonly<{
  mode: ReviewMode
  onChange: (mode: ReviewMode) => void
}>

function ModeButton({
  pressed,
  onClick,
  children,
}: Readonly<{
  pressed: boolean
  onClick: () => void
  children: ReactNode
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm font-medium transition',
        pressed
          ? 'border-[var(--color-nav-accent)] bg-[var(--color-accent-soft)] text-zinc-100'
          : 'border-[var(--color-border)] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]',
      )}
    >
      {children}
    </button>
  )
}

export function ReviewModeToggle({ mode, onChange }: ReviewModeToggleProps) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
      <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Review type
      </legend>
      <div className="flex flex-wrap gap-2">
        <ModeButton
          pressed={mode === 'categories'}
          onClick={() => onChange('categories')}
        >
          Categories
        </ModeButton>
        <ModeButton
          pressed={mode === 'transfers'}
          onClick={() => onChange('transfers')}
        >
          Transfers
        </ModeButton>
      </div>
    </fieldset>
  )
}
