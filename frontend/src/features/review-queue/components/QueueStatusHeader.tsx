import type { ReviewMode } from '@/features/review-queue/components/ReviewModeToggle'

type QueueStatusHeaderProps = {
  mode: ReviewMode
  pendingCount: number
}

export function QueueStatusHeader({ mode, pendingCount }: QueueStatusHeaderProps) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
        Review queue
      </h1>
      {mode === 'categories' ? (
        <>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Ambiguous merchant clusters need a category so future imports inherit
            the same mapping.
          </p>
          <p className="mt-4 text-sm font-medium text-zinc-200">
            {pendingCount === 0
              ? 'No clusters awaiting review.'
              : `${pendingCount} cluster${pendingCount === 1 ? '' : 's'} awaiting review`}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Review internal transfers linked across your accounts. Source is the
            outflow leg (negative amount); destination is the matching inflow.
          </p>
          <p className="mt-4 text-sm font-medium text-zinc-200">
            Account transfers review
          </p>
        </>
      )}
    </div>
  )
}
