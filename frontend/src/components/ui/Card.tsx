import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

type CardProps = {
  className?: string
  children: ReactNode
  title?: string
  description?: string
}

export function Card({ className, children, title, description }: CardProps) {
  return (
    <section className={cn('glass-panel rounded-3xl p-6 text-left', className)}>
      {(title || description) && (
        <header className="mb-4">
          {title && (
            <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          )}
          {description && (
            <p className="mt-1 text-sm text-zinc-500">{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  )
}
