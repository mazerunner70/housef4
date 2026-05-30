import { useMemo } from 'react'

import { useReviewQueue } from '@/hooks/useReviewQueue'
import { useTransactionFiles } from '@/hooks/useTransactionFiles'
import { resolveCurrencyCode } from '@/lib/formatCurrency'

/**
 * ISO 4217 for a single import batch: `TRANSACTION_FILE.format.currency`,
 * then profile default from the review queue, then USD.
 */
export function useImportFileCurrency(
  transactionFileId: string | undefined,
): string {
  const filesQuery = useTransactionFiles()
  const reviewQuery = useReviewQueue()

  return useMemo(() => {
    const id = transactionFileId?.trim()
    if (!id) {
      return resolveCurrencyCode(undefined, reviewQuery.data?.default_currency)
    }
    const file = filesQuery.data?.transaction_files.find((f) => f.id === id)
    return resolveCurrencyCode(
      file?.format.currency,
      reviewQuery.data?.default_currency,
    )
  }, [
    transactionFileId,
    filesQuery.data?.transaction_files,
    reviewQuery.data?.default_currency,
  ])
}
