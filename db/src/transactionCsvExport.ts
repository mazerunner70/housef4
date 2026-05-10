import type {
  AccountRecord,
  TransactionFileRecord,
  TransactionRecord,
} from './types';

/** RFC 4180-style CSV cell: quote when needed, escape internal quotes. */
export function escapeCsvCell(value: string): string {
  let s = value;
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'string') return escapeCsvCell(v);
  return escapeCsvCell(JSON.stringify(v));
}

const CSV_COLUMNS = [
  'user_id',
  'id',
  'date',
  'raw_merchant',
  'cleaned_merchant',
  'amount',
  'file_amount',
  'cluster_id',
  'category',
  'status',
  'is_recurring',
  'transaction_file_id',
  'account_id',
  'account_name',
  'import_file_name',
  'import_source_format',
  'import_file_currency',
  'import_amount_negated',
  'suggested_category',
  'category_confidence',
  'match_type',
  'match_id',
  'match_source',
  'match_confidence',
  'merchant_embedding_json',
] as const;

export type TransactionCsvColumn = (typeof CSV_COLUMNS)[number];

export interface FormatTransactionsAsCsvInput {
  transactions: TransactionRecord[];
  accounts: AccountRecord[];
  transactionFiles: TransactionFileRecord[];
  /** When omitted, uses stored `cleaned_merchant` or empty string (matches backup export). */
  resolveCleanedMerchant?: (t: TransactionRecord) => string;
}

/**
 * One UTF-8 CSV table row per transaction: every persisted transaction field plus joined
 * account and import-file metadata (`transaction_files.account_id` → account name; source filename).
 * Rows sorted like backup export: `date` descending, then `id` ascending.
 */
export function formatTransactionsAsCsv(input: FormatTransactionsAsCsvInput): string {
  const resolveCleaned =
    input.resolveCleanedMerchant ??
    ((t: TransactionRecord) => t.cleaned_merchant ?? '');

  const accountNameById = new Map<string, string>();
  for (const a of input.accounts) {
    accountNameById.set(a.id, a.name);
  }

  type FileMeta = {
    account_id: string;
    import_file_name: string;
    import_source_format: string;
    import_file_currency: string;
    import_amount_negated: boolean | undefined;
  };
  const fileMetaById = new Map<string, FileMeta>();
  for (const f of input.transactionFiles) {
    fileMetaById.set(f.id, {
      account_id: f.account_id,
      import_file_name: f.source?.name ?? '',
      import_source_format: f.format?.source_format ?? '',
      import_file_currency: f.format?.currency ?? '',
      import_amount_negated: f.format?.amount_negated,
    });
  }

  const sorted = [...input.transactions].sort((a, b) => {
    const byDate = b.date - a.date;
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });

  const lines: string[] = [CSV_COLUMNS.join(',')];

  for (const t of sorted) {
    const fm = fileMetaById.get(t.transaction_file_id);
    const accountId = fm?.account_id ?? '';
    const accountName = accountId ? (accountNameById.get(accountId) ?? '') : '';

    const embeddingJson =
      t.merchant_embedding !== undefined && t.merchant_embedding.length > 0
        ? JSON.stringify(t.merchant_embedding)
        : '';

    const row = [
      cell(t.user_id),
      cell(t.id),
      cell(t.date),
      cell(t.raw_merchant),
      cell(resolveCleaned(t)),
      cell(t.amount),
      cell(t.file_amount ?? ''),
      cell(t.cluster_id ?? ''),
      cell(t.category),
      cell(t.status),
      cell(t.is_recurring),
      cell(t.transaction_file_id),
      cell(accountId),
      cell(accountName),
      cell(fm?.import_file_name ?? ''),
      cell(fm?.import_source_format ?? ''),
      cell(fm?.import_file_currency ?? ''),
      fm?.import_amount_negated === undefined
        ? ''
        : cell(fm.import_amount_negated),
      cell(t.suggested_category ?? ''),
      cell(t.category_confidence ?? ''),
      cell(t.match_type ?? ''),
      cell(t.match_id ?? ''),
      cell(t.match_source ?? ''),
      cell(t.match_confidence ?? ''),
      cell(embeddingJson),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n') + '\n';
}
