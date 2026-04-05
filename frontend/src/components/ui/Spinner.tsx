import { cn } from '@/lib/cn'

type SpinnerProps = {
  className?: string
  label?: string
}

export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-2 text-zinc-400', className)}
      role="status"
      aria-live="polite"
    >
      <span
        className="size-5 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400"
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </div>
  )
}
