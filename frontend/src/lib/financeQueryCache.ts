import type { QueryClient } from '@tanstack/react-query'

const CLUSTER_SENSITIVE_QUERY_KEYS = [
  ['transactions'],
  ['review-queue'],
  ['metrics'],
] as const

/**
 * Clear client-held finance data that assumes prior transactional `cluster_id`
 * values remain valid when a corpus import starts (`api_contract.md` §1 SPA
 * obligations; `import_transaction_files.md` §11.1.3).
 *
 * Awaits in-flight fetch cancellation before resetting matching queries to
 * their initial empty state (without removing cache entries), so late responses
 * cannot repopulate stale cluster data and `invalidateFinanceCaches` can still
 * proactively refetch inactive observers (`refetchType: 'all'`) after commit or
 * failure recovery.
 */
export async function neutralizeClusterKeyedCaches(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    CLUSTER_SENSITIVE_QUERY_KEYS.map((queryKey) =>
      queryClient.cancelQueries({ queryKey }),
    ),
  )
  for (const queryKey of CLUSTER_SENSITIVE_QUERY_KEYS) {
    queryClient.resetQueries({ queryKey })
  }
}

/**
 * Invalidate and refetch finance queries after authoritative server changes
 * (import success, restore, or import failure when caches were neutralized).
 *
 * Uses `refetchType: 'all'` so inactive queries (e.g. dashboard metrics while
 * on `/import`) refetch without waiting for remount.
 */
export function invalidateFinanceCaches(queryClient: QueryClient): void {
  for (const queryKey of [
    ['metrics'],
    ['transactions'],
    ['review-queue'],
    ['transaction-files'],
    ['accounts'],
  ] as const) {
    void queryClient.invalidateQueries({ queryKey, refetchType: 'all' })
  }
}
