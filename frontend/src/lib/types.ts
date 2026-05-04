import type { ImportSourceFormat } from '@/lib/importFormats'

export type SpendingCategoryRow = {
  category: string
  amount: number
  /** When set, UI shows spent / budget (Aura dashboard pattern). */
  budget?: number
}

export type MetricsResponse = {
  /** Total number of transaction rows in the app (from metrics snapshot). */
  transaction_count: number
  monthly_cashflow: {
    income: number
    expenses: number
    net: number
  }
  net_worth: number
  /** Month-over-month change for trend chip (e.g. +0.041 → +4.1%). */
  net_worth_change_pct?: number
  /** Liquid assets minus liabilities (aligned with PRD). */
  liquid_assets?: number
  liabilities?: number
  spending_by_category: SpendingCategoryRow[]
  /** Optional series for charts when the API supplies history. */
  cashflow_history?: {
    label: string
    /** Present on newer API payloads; older rows fall back to parsing `label`. */
    month_start_ms?: number
    income: number
    expenses: number
  }[]
  /** e.g. "January 1 – June 30" for cash flow card subtitle. */
  cashflow_period_label?: string
}

export type Transaction = {
  id: string
  /** Milliseconds since Unix epoch (UTC); see API contract. */
  date: number
  raw_merchant: string
  /** Normalized merchant text for clustering; derived on the server when missing in storage. */
  cleaned_merchant: string
  amount: number
  cluster_id: string
  category: string
  status: 'CLASSIFIED' | 'PENDING_REVIEW'
  is_recurring: boolean
  /** Id of the import file (`TRANSACTION_FILE`) that created this row. */
  transaction_file_id: string
  suggested_category?: string | null
  category_confidence?: number
  match_type?: string
}

export type TransactionsResponse = {
  transactions: Transaction[]
}

export type PendingCluster = {
  cluster_id: string
  sample_merchants: string[]
  total_transactions: number
  total_amount: number
  suggested_category: string | null
  /** When set, from import (e.g. OFX `CURDEF`) on the batch that formed this cluster aggregate. */
  currency?: string
}

export type ReviewQueueResponse = {
  /** User profile default (ISO 4217); used when a cluster has no `currency` yet. */
  default_currency: string
  pending_clusters: PendingCluster[]
}

export type TagRuleRequest = {
  cluster_id: string
  assigned_category: string
}

export type TagRuleResponse = {
  success: boolean
  updated_transactions: number
}

/** `GET /api/accounts` — user-labeled financial accounts for imports. */
export type AccountRow = {
  id: string
  name: string
  created_at: number
}

export type AccountsResponse = {
  accounts: AccountRow[]
}

export type ImportParseResult = {
  rowCount: number
  knownMerchants: number
  unknownMerchants: number
  /** Transactions updated with new cluster assignments after a full-corpus re-cluster. */
  existingTransactionsUpdated?: number
  /** Distinct cluster ids among rows in this import batch. */
  newClustersTouched?: number
  /** Id of the persisted `TRANSACTION_FILE` record for this run. */
  importFileId: string
  /** Detected from filename / MIME; echoed by `POST /api/imports` when wired. */
  sourceFormat?: ImportSourceFormat
}

/** Same shape as `ImportIngestResult` / the body of a successful `POST /api/imports` summary. */
export type ImportIngestSnapshot = {
  rowCount: number
  knownMerchants: number
  unknownMerchants: number
  existingTransactionsUpdated: number
  newClustersTouched: number
}

/** `GET /api/transaction-files` — same sections as the persisted `TRANSACTION_FILE` item. */
export type TransactionFileSource = {
  name: string
  size_bytes: number
  content_type?: string
}

export type TransactionFileFormat = {
  source_format?: string
  /** When known from import metadata (e.g. OFX). */
  currency?: string
}

export type TransactionFileTiming = {
  started_at: number
  completed_at: number
}

export type TransactionFile = {
  user_id: string
  id: string
  /** Import target account; empty when the file predates accounts. */
  account_id: string
  source: TransactionFileSource
  format: TransactionFileFormat
  timing: TransactionFileTiming
  /** Ingest + re-cluster summary (matches `ImportIngestSnapshot`). */
  result: ImportIngestSnapshot
}

export type TransactionFilesResponse = {
  transaction_files: TransactionFile[]
}

/** Result of `GET /api/backup/export` before triggering a browser save-as. */
export type BackupExportDownload = {
  blob: Blob
  /** From `Content-Disposition` when present; else a safe default. */
  filename: string
}
