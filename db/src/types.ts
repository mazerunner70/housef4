/** Shapes aligned with `docs/03_detailed_design/api_contract.md` (JSON uses epoch ms for dates). */

export type TransactionStatus = 'CLASSIFIED' | 'PENDING_REVIEW';

export interface TransactionRecord {
  /** Logical user identifier (also encoded in `PK` as `USER#<user_id>`). */
  user_id: string;
  id: string;
  date: number;
  raw_merchant: string;
  /**
   * Normalized merchant line for clustering / rules (see `merchantNormalize` in backend).
   * Omitted on legacy rows until backfill; API may derive from `raw_merchant`.
   */
  cleaned_merchant?: string;
  amount: number;
  cluster_id: string;
  category: string;
  status: TransactionStatus;
  is_recurring: boolean;
}

export interface PendingClusterRecord {
  cluster_id: string;
  sample_merchants: string[];
  total_transactions: number;
  total_amount: number;
  suggested_category: string | null;
}

export interface MetricsSnapshot {
  monthly_cashflow: {
    income: number;
    expenses: number;
    net: number;
  };
  net_worth: number;
  spending_by_category: { category: string; amount: number }[];
}

/** One normalized row produced by import parsing before persistence. */
export interface ImportTransactionInput {
  /** Must match the `userId` passed to `ingestImportBatch`. */
  user_id: string;
  id: string;
  date: number;
  raw_merchant: string;
  /** Same semantics as `TransactionRecord.cleaned_merchant`; persisted on ingest. */
  cleaned_merchant: string;
  amount: number;
  cluster_id: string;
  category: string;
  status: TransactionStatus;
  is_recurring: boolean;
  /** Whether this row matched an existing cluster / high-confidence category (import summary). */
  known_merchant: boolean;
}

export interface ImportIngestResult {
  rowCount: number;
  knownMerchants: number;
  unknownMerchants: number;
}
