import type { AccountRow, Transaction, TransactionFile } from '@/lib/types'
import { resolveCurrencyCode } from '@/lib/formatCurrency'

export type TransactionWithAccount = Transaction & {
  account_id: string
  account_name: string
  /** Resolved display currency for this row. */
  currency: string
}

export type TransferPair = {
  pairing_id: string
  source: TransactionWithAccount
  destination: TransactionWithAccount
  pairing_source?: string
  pairing_confidence?: string
  /** Latest leg date for sorting. */
  date: number
  /** Absolute transfer amount (source leg is canonical negative). */
  amount: number
}

export type TransferGroupBy = 'source' | 'destination'

export function enrichTransactionsWithAccount(
  transactions: Transaction[],
  files: TransactionFile[],
  accounts: AccountRow[],
): TransactionWithAccount[] {
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]))
  const fileAccountById = new Map(files.map((f) => [f.id, f.account_id]))
  const fileCurrencyById = new Map(
    files.map((f) => [f.id, f.format.currency] as const),
  )

  return transactions.map((t) => {
    const account_id = fileAccountById.get(t.transaction_file_id) ?? ''
    const account_name = account_id
      ? (accountNameById.get(account_id) ?? account_id)
      : 'Unknown account'
    const currency = resolveCurrencyCode(
      t.currency,
      fileCurrencyById.get(t.transaction_file_id),
    )
    return { ...t, account_id, account_name, currency }
  })
}

export function buildTransferPairs(transactions: TransactionWithAccount[]): {
  pairs: TransferPair[]
  incomplete: TransactionWithAccount[]
} {
  const byPairingId = new Map<string, TransactionWithAccount[]>()
  for (const t of transactions) {
    if (!t.pairing_id) continue
    const list = byPairingId.get(t.pairing_id) ?? []
    list.push(t)
    byPairingId.set(t.pairing_id, list)
  }

  const pairs: TransferPair[] = []
  const incomplete: TransactionWithAccount[] = []

  for (const [pairing_id, legs] of byPairingId) {
    const negatives = legs.filter((l) => l.amount < 0)
    const positives = legs.filter((l) => l.amount > 0)

    if (negatives.length === 1 && positives.length === 1) {
      const source = negatives[0]!
      const destination = positives[0]!
      pairs.push({
        pairing_id,
        source,
        destination,
        pairing_source: source.pairing_source ?? destination.pairing_source,
        pairing_confidence:
          source.pairing_confidence ?? destination.pairing_confidence,
        date: Math.max(source.date, destination.date),
        amount: Math.abs(source.amount),
      })
    } else {
      incomplete.push(...legs)
    }
  }

  pairs.sort((a, b) => b.date - a.date)
  return { pairs, incomplete }
}

export function groupTransferPairs(
  pairs: TransferPair[],
  groupBy: TransferGroupBy,
): Map<string, TransferPair[]> {
  const groups = new Map<string, TransferPair[]>()
  for (const pair of pairs) {
    const leg = groupBy === 'source' ? pair.source : pair.destination
    const key = leg.account_id || leg.account_name
    const list = groups.get(key) ?? []
    list.push(pair)
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => b.date - a.date)
  }
  return groups
}

export function sortedTransferGroupEntries(
  groups: Map<string, TransferPair[]>,
  accounts: AccountRow[],
  groupBy: TransferGroupBy,
): { accountId: string; accountName: string; pairs: TransferPair[] }[] {
  const nameById = new Map(accounts.map((a) => [a.id, a.name]))

  return [...groups.entries()]
    .map(([accountId, pairs]) => {
      const sample = groupBy === 'source' ? pairs[0]?.source : pairs[0]?.destination
      const accountName =
        nameById.get(accountId) ??
        sample?.account_name ??
        (accountId || 'Unknown account')
      return { accountId, accountName, pairs }
    })
    .sort((a, b) => a.accountName.localeCompare(b.accountName))
}
