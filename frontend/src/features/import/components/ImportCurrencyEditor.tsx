import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { patchTransactionFileCurrency } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { invalidateFinanceCaches } from '@/lib/financeQueryCache'

type ImportCurrencyEditorProps = {
  readonly importFileId: string
  readonly initialCurrency: string
  readonly onApplied?: (currency: string) => void
}

function normalizeInput(code: string): string {
  return code.trim().toUpperCase().slice(0, 3)
}

export function ImportCurrencyEditor({
  importFileId,
  initialCurrency,
  onApplied,
}: ImportCurrencyEditorProps) {
  const queryClient = useQueryClient()
  const [currency, setCurrency] = useState(() => normalizeInput(initialCurrency))
  const [setAsDefault, setSetAsDefault] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setCurrency(normalizeInput(initialCurrency))
  }, [initialCurrency])

  const mutation = useMutation({
    mutationFn: () =>
      patchTransactionFileCurrency(importFileId, {
        currency,
        setDefaultCurrency: setAsDefault,
      }),
    onSuccess: (result) => {
      setLocalError(null)
      setSetAsDefault(false)
      invalidateFinanceCaches(queryClient)
      onApplied?.(result.currency)
    },
    onError: (e) => {
      setLocalError(e instanceof Error ? e.message : 'Could not update currency')
    },
  })

  const dirty =
    normalizeInput(currency) !== normalizeInput(initialCurrency) || setAsDefault
  const valid = /^[A-Z]{3}$/.test(normalizeInput(currency))

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-4">
      <p className="text-sm font-medium text-zinc-200">Import currency</p>
      <p className="mt-1 text-xs text-zinc-500">
        Resolved at import from the file, your account history, or profile default.
        Adjust here if the code is wrong — updates this file&apos;s transactions and
        related clusters.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="max-w-[8rem] flex-1">
          <label htmlFor="import-currency" className="sr-only">
            Currency code
          </label>
          <input
            id="import-currency"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={3}
            value={currency}
            onChange={(e) => {
              setCurrency(normalizeInput(e.target.value))
              setLocalError(null)
            }}
            className="w-full rounded-lg border border-white/[0.12] bg-zinc-900/80 px-3 py-2 font-mono text-sm uppercase tracking-wider text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            aria-invalid={!valid && currency.length > 0}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty || !valid || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Applying…' : 'Apply currency'}
        </Button>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          className="mt-0.5 rounded border-white/20 bg-zinc-900"
          checked={setAsDefault}
          onChange={(e) => setSetAsDefault(e.target.checked)}
        />
        <span>
          Use as my default currency for future imports
        </span>
      </label>
      {localError && (
        <p className="mt-2 text-sm text-red-300/90" role="alert">
          {localError}
        </p>
      )}
      {mutation.isSuccess && !dirty && (
        <p className="mt-2 text-sm text-emerald-400/90">Currency saved.</p>
      )}
    </div>
  )
}
