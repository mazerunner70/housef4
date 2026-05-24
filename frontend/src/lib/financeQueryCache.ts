import type { QueryClient } from '@tanstack/react-query'

/**
 * Drop client-held finance data that assumes prior transactional `cluster_id`
 * values remain valid when a corpus import starts (`api_contract.md` §1 SPA
 * obligations; `import_transaction_files.md` §11.1.3).
 *
 * Does not refetch — callers refetch after a committed import (`200`) or on
 * failure when the ledger is unchanged.
 */
export function neutralizeClusterKeyedCaches(queryClient: QueryClient): void {
  for (const queryKey of [
    ['transactions'],
    ['review-queue'],
    ['metrics'],
  ] as const) {
    void queryClient.cancelQueries({ queryKey })
    queryClient.removeQueries({ queryKey })
  }
}

/**
 * Invalidate and refetch finance queries after authoritative server changes
 * (import success, restore, or import failure when caches were neutralized).
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
