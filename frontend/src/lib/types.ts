import type { ImportSourceFormat } from '@/lib/importFormats'

export type SpendingCategoryRow = {
  category: string
  amount: number
  /** When set, UI shows spent / budget (Aura dashboard pattern). */
  budget?: number
}

export type MetricsResponse = {
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
  cashflow_history?: { label: string; income: number; expenses: number }[]
  /** e.g. "January 1 – June 30" for cash flow card subtitle. */
  cashflow_period_label?: string
}

export type Transaction = {
  id: string
  /** Milliseconds since Unix epoch (UTC); see API contract. */
  date: number
  raw_merchant: string
  amount: number
  cluster_id: string
  category: string
  status: 'CLASSIFIED' | 'PENDING_REVIEW'
  is_recurring: boolean
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
}

export type ReviewQueueResponse = {
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

export type ImportParseResult = {
  rowCount: number
  knownMerchants: number
  unknownMerchants: number
  /** Detected from filename / MIME; echoed by `POST /api/imports` when wired. */
  sourceFormat?: ImportSourceFormat
}
