import type { Transaction } from '@/lib/types'
import { cn } from '@/lib/cn'

type RecurringSubscriptionsListProps = {
  transactions: Transaction[]
  className?: string
}

export function RecurringSubscriptionsList({
  transactions,
  className,
}: RecurringSubscriptionsListProps) {
  const recurring = transactions.filter((t) => t.is_recurring)

  return (
    <section className={cn('glass-panel rounded-3xl p-6 text-left', className)}>
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-zinc-100">Recurring charges</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Detected from repeating amounts and timing within the same cluster.
        </p>
      </header>
      {recurring.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No recurring subscriptions detected in this sample.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {recurring.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-medium text-zinc-100">{t.raw_merchant}</p>
                <p className="text-sm text-zinc-500">{t.category}</p>
              </div>
              <p className="tabular-nums text-zinc-200">
                {t.amount.toLocaleString(undefined, {
                  style: 'currency',
                  currency: 'USD',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
