/**
 * Unified planning row model (§4.4 index alignment).
 *
 * Replaces parallel arrays (`parsed[i]` ↔ `newTransactionIds[i]` ↔ clusterable flags)
 * with a single ordered list for stages **5–8**.
 */

import type { TransactionRecord } from '@housef4/db';

import type { ParsedImportRow } from '../parse/canonical';
import {
  map,
  partition,
  sortBy,
  zipStrict,
} from '../utils/lodashImport';

export type PlanningRow =
  | {
      kind: 'existing';
      id: string;
      record: TransactionRecord;
      clusterable: boolean;
    }
  | {
      kind: 'new';
      id: string;
      row: ParsedImportRow;
      clusterable: boolean;
    };

export type PartitionedPlanningRows = Readonly<{
  clusterable: PlanningRow[];
  nonClusterable: PlanningRow[];
}>;

/**
 * Build the full planning row list: existing (date, id) then new (parse order).
 * `zipStrict` aligns parsed rows with stage **5** ids; `partition` drives clusterable flags.
 */
export function buildPlanningRows(
  existing: TransactionRecord[],
  parsed: ParsedImportRow[],
  newTransactionIds: readonly string[],
  pairedTxnIds: ReadonlySet<string>,
): PlanningRow[] {
  if (newTransactionIds.length !== parsed.length) {
    throw new Error(
      'buildPlanningRows: newTransactionIds length must match parsed rows',
    );
  }

  const existingSorted = sortBy(existing, [(t) => t.date, (t) => t.id]);
  const existingRows: PlanningRow[] = map(existingSorted, (record) => ({
    kind: 'existing' as const,
    id: record.id,
    record,
    clusterable: !pairedTxnIds.has(record.id),
  }));

  const newRows: PlanningRow[] = map(
    zipStrict(parsed, newTransactionIds),
    ([row, id]) => ({
      kind: 'new' as const,
      id,
      row,
      clusterable: !pairedTxnIds.has(id),
    }),
  );

  return [...existingRows, ...newRows];
}

/** Split planning rows by merchant-cluster eligibility (stage **7** pairing exclusion). */
export function partitionPlanningRows(
  rows: readonly PlanningRow[],
): PartitionedPlanningRows {
  const [clusterable, nonClusterable] = partition(rows, (r) => r.clusterable);
  return { clusterable, nonClusterable };
}

/** Stage **8** input — clusterable rows only, preserving planning order. */
export function clusterableRows(rows: readonly PlanningRow[]): PlanningRow[] {
  return partitionPlanningRows(rows).clusterable;
}
