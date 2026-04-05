import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/cn'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  children: ReactNode
}

export function Button({
  className,
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-nav-accent)] disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' &&
          'bg-[var(--color-accent)] text-white shadow-lg hover:brightness-110',
        variant === 'secondary' &&
          'border border-[var(--color-border)] bg-white/[0.03] text-zinc-100 hover:bg-white/[0.07]',
        variant === 'ghost' &&
          'text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]',
        className,
      )}
      {...props}
    />
  )
}
