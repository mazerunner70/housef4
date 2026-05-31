import { useEffect, useId, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useTransactionsByCluster } from '@/hooks/useTransactions'
import { useTransactionFiles } from '@/hooks/useTransactionFiles'
import { cn } from '@/lib/cn'
import { formatCurrencyAmount, resolveCurrencyCode } from '@/lib/formatCurrency'

type ClusterMatchingTransactionsDialogProps = {
  clusterId: string
  /** From cluster aggregate or profile default when the cluster has no stored currency. */
  currencyCode: string
  onClose: () => void
}

function formatTransactionDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function ClusterMatchingTransactionsDialog({
  clusterId,
  currencyCode,
  onClose,
}: Readonly<ClusterMatchingTransactionsDialogProps>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const query = useTransactionsByCluster(clusterId, true)
  const filesQuery = useTransactionFiles()
  const formattedRows = useMemo(
    () =>
      query.data?.transactions.map((t) => {
        const fileCurrency = filesQuery.data?.transaction_files.find(
          (f) => f.id === t.transaction_file_id,
        )?.format.currency
        const code = resolveCurrencyCode(t.currency ?? fileCurrency ?? currencyCode)
        return {
          id: t.id,
          dateLabel: formatTransactionDate(t.date),
          merchant: t.raw_merchant,
          amountLabel: formatCurrencyAmount(t.amount, code),
        }
      }) ?? [],
    [query.data?.transactions, filesQuery.data?.transaction_files, currencyCode],
  )

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return

    const frame = requestAnimationFrame(() => {
      if (!d.open) d.showModal()
    })

    return () => {
      cancelAnimationFrame(frame)
      d.close()
    }
  }, [])

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    const handleClose = () => {
      onClose()
    }
    d.addEventListener('close', handleClose)
    return () => d.removeEventListener('close', handleClose)
  }, [onClose])

  return createPortal(
    <dialog
      ref={dialogRef}
      className={cn(
        'fixed top-1/2 left-1/2 z-[60] flex max-h-[min(100vh-2rem,85vh)] w-[min(100vw-1.5rem,44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-0 text-[var(--color-text-strong)] shadow-xl',
        '[&::backdrop]:bg-black/65',
      )}
      aria-labelledby={titleId}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <h2 id={titleId} className="text-lg font-semibold text-zinc-100">
          Matching transactions
        </h2>
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 px-2 py-1"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {query.isPending && (
          <div className="flex justify-center py-12">
            <Spinner label="Loading transactions" />
          </div>
        )}
        {query.isError && (
          <p className="text-sm text-rose-400" role="alert">
            Could not load transactions.
          </p>
        )}
        {query.isSuccess && query.data.transactions.length === 0 && (
          <p className="text-sm text-zinc-500">
            No transactions in this cluster.
          </p>
        )}
        {query.isSuccess && formattedRows.length > 0 && (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs font-medium tracking-wide text-zinc-500 uppercase">
                <th className="pb-3 pr-4 font-medium">Date</th>
                <th className="pb-3 pr-4 font-medium">Merchant</th>
                <th className="pb-3 text-right font-medium tabular-nums">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="text-zinc-200">
              {formattedRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--color-border-subtle)] last:border-0"
                >
                  <td className="max-w-[40%] align-top py-3 pr-4 text-zinc-300">
                    {row.dateLabel}
                  </td>
                  <td className="align-top py-3 pr-4 break-words text-zinc-100">
                    {row.merchant}
                  </td>
                  <td className="align-top py-3 text-right tabular-nums text-zinc-100">
                    {row.amountLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </dialog>,
    document.body,
  )
}
