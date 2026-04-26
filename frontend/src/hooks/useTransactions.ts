import { useQuery } from '@tanstack/react-query'

import { getTransactions } from '@/api/client'

/** Full transaction list for the signed-in user (`GET /api/transactions`). */
export function useTransactions() {
  return useQuery({
    queryKey: ['transactions', 'all'],
    queryFn: () => getTransactions(),
  })
}

/** Rows created in a single import (`GET /api/transactions?transactionFileId=…`). */
export function useTransactionsByImportFile(
  transactionFileId: string | undefined,
) {
  const id = transactionFileId?.trim() || undefined
  return useQuery({
    queryKey: ['transactions', 'by-file', id ?? ''],
    queryFn: () => getTransactions({ transactionFileId: id! }),
    enabled: Boolean(id),
  })
}

/** Rows in a pending-review cluster (`GET /api/transactions?clusterId=…`). */
export function useTransactionsByCluster(
  clusterId: string | undefined,
  enabled: boolean,
) {
  const id = clusterId?.trim() || undefined
  return useQuery({
    queryKey: ['transactions', 'by-cluster', id ?? ''],
    queryFn: () => getTransactions({ clusterId: id! }),
    enabled: Boolean(id) && enabled,
  })
}
