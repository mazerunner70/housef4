/**
 * Shapes aligned with `docs/03_detailed_design/api_contract.md` (JSON uses epoch ms for dates)
 * and persisted record layout in `docs/03_detailed_design/database/data_model.md`.
 */

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
  /** Absent on legacy or unclustered rows when backfilled. */
  cluster_id?: string;
  category: string;
  status: TransactionStatus;
  is_recurring: boolean;
  /** Cached MiniLM / hash embedding from last clustering run (384 dims). */
  merchant_embedding?: number[];
  suggested_category?: string | null;
  category_confidence?: number;
  match_type?: string;
  /** Import file id for the `TRANSACTION_FILE` row that created this transaction (same id as in `FILE#…` / `importFileId`). */
  transaction_file_id: string;
}

/** Partial update applied to existing transactions after a re-clustering import. */
export interface ExistingTransactionPatch {
  id: string;
  cluster_id: string;
  category: string;
  status: TransactionStatus;
  cleaned_merchant: string;
  merchant_embedding: number[];
  suggested_category: string | null;
  category_confidence: number;
  match_type: string;
}

export interface PendingClusterRecord {
  cluster_id: string;
  sample_merchants: string[];
  total_transactions: number;
  total_amount: number;
  suggested_category: string | null;
  /** Denormalized from the import batch(es); UI prefers this, then profile default, then USD. */
  currency?: string;
}

/** User-defined label for a bank / card account; imports attach a transaction file to one account. */
export interface AccountRecord {
  user_id: string;
  id: string;
  name: string;
  created_at: number;
}

export interface MetricsSnapshot {
  /** Number of transaction rows the metrics are based on. */
  transaction_count: number;
  monthly_cashflow: {
    income: number;
    expenses: number;
    net: number;
  };
  net_worth: number;
  spending_by_category: { category: string; amount: number }[];
  /** UTC calendar months from earliest transaction through current month, oldest-first (see `computeDashboardMetrics`). */
  cashflow_history?: {
    label: string;
    month_start_ms: number;
    income: number;
    expenses: number;
  }[];
  cashflow_period_label?: string;
  /** Month-over-month relative change in net cashflow (not literal net worth). */
  net_worth_change_pct?: number;
}

/** Transient marker on primary table during `POST /api/backup/restore` (see `database/data_model.md` 8.2a). */
export interface RestoreLockRecord {
  entity_type: 'RESTORE_LOCK';
  user_id: string;
  /** Epoch ms UTC; omitted when the row is missing this attribute or it is unreadable (legacy/corrupt). */
  restore_started_at?: number;
  backup_schema_version?: number;
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
  suggested_category?: string | null;
  category_confidence?: number;
  match_type?: string;
  merchant_embedding?: number[];
}

export interface ImportIngestResult {
  rowCount: number;
  knownMerchants: number;
  unknownMerchants: number;
  /** Existing transactions updated with new cluster_id / embeddings after re-cluster. */
  existingTransactionsUpdated: number;
  /** Distinct cluster ids among rows in this import batch. */
  newClustersTouched: number;
}

/** §1 — Multipart upload: raw bytes, client filename, part MIME. */
export interface TransactionFileSource {
  name: string;
  size_bytes: number;
  content_type?: string;
}

/**
 * §2 — How the file is classified for parsing (`parseImportBuffer` / sniffing).
 * Filled after format detection, before or alongside row parse.
 */
export interface TransactionFileFormat {
  source_format?: string;
  /** ISO 4217 when known (e.g. from OFX `CURDEF`), for display. */
  currency?: string;
}

/**
 * §3 — Clock: when the server began processing this import (after extract) and when the run finished.
 */
export interface TransactionFileTiming {
  started_at: number;
  completed_at: number;
}

/**
 * One persisted import: sections match how the run proceeds — source file → format →
 * timing → result stats. See `database/data_model.md`.
 */
export interface TransactionFileInput {
  id: string;
  /** `ACCOUNT#…` id for the user’s financial account this file belongs to. */
  account_id: string;
  source: TransactionFileSource;
  format: TransactionFileFormat;
  timing: TransactionFileTiming;
  /** Final batch summary (ingest + re-cluster), same shape as `ImportIngestResult`. */
  result: ImportIngestResult;
}

/** Stored row: same sections as {@link TransactionFileInput} plus `user_id`. */
export type TransactionFileRecord = TransactionFileInput & { user_id: string };

/**
 * Logical backup artifact schema version **1**.
 * Detailed wire dictionary: `docs/03_detailed_design/backup-schema/v1.md`.
 * High-level envelope + Dynamo mapping: `docs/03_detailed_design/database/data_model.md` §8.
 */
export const BACKUP_SCHEMA_VERSION_V1 = 1 as const;

/** Body for `GET /api/backup/export` / input for restore (excluding raw import blobs). */
export interface BackupSnapshotV1 {
  backup_schema_version: typeof BACKUP_SCHEMA_VERSION_V1;
  exported_at: number;
  app_user_id: string;
  accounts: Record<string, unknown>[];
  profile: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  transactions: Record<string, unknown>[];
  clusters: Record<string, unknown>[];
  transaction_files: Record<string, unknown>[];
}
