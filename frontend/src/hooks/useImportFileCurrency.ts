import { useMemo } from 'react'

import { useReviewQueue } from '@/hooks/useReviewQueue'
import { useTransactionFiles } from '@/hooks/useTransactionFiles'
import { resolveCurrencyCode } from '@/lib/formatCurrency'

/**
 * Currency for formatting amounts on the import transactions review page.
 */
export function useImportFileCurrency(importFileId: string | undefined): string {
  const filesQuery = useTransactionFiles()
  const reviewQuery = useReviewQueue()

  return useMemo(() => {
    const id = importFileId?.trim()
    if (!id) return 'USD'
    const file = filesQuery.data?.transaction_files.find((f) => f.id === id)
    if (file?.format.currency) {
      return resolveCurrencyCode(file.format.currency)
    }
    const cluster = reviewQuery.data?.pending_clusters.find((c) =>
      c.sample_merchants.some(Boolean),
    )
    if (cluster?.currency) {
      return resolveCurrencyCode(cluster.currency)
    }
    return 'USD'
  }, [importFileId, filesQuery.data?.transaction_files, reviewQuery.data?.pending_clusters])
}
