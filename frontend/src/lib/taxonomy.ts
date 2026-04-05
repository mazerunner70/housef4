/**
 * Mandatory Stage 1 categorization taxonomy (see docs/01_discovery/stage_1_understanding_mvp.md).
 */
export const TAXONOMY_CATEGORIES = [
  'Income',
  'Housing & Utilities',
  'Food & Groceries',
  'Transportation',
  'Subscriptions & Recurring',
  'Discretionary & Lifestyle',
  'Debt Payments',
  'Health & Wellness',
  'Wealth & Savings',
  'Uncategorized',
] as const

export type TaxonomyCategory = (typeof TAXONOMY_CATEGORIES)[number]
