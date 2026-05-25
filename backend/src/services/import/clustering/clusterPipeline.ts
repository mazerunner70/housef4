import type { TransactionRecord } from '@housef4/db';

import {
  clusterableRows,
  type PlanningRow,
} from '../planning/planningRows';
import {
  compact,
  difference,
  filter,
  map,
  uniq,
  zipWith,
} from '../utils/lodashImport';
import {
  internalTransferAssignment,
  type Assignment,
} from './assignment';
import type { CategorySuggestion } from './categoryClassifier';
import { runClusterPass, type SourceRow } from './clusterPass';
import type { MerchantEmbedder } from './merchantsEmbedder';

export {
  DBSCAN_EPS,
  DBSCAN_MIN_SAMPLES,
  splitNoiseLabels,
} from './labelGroups';

export {
  INTERNAL_TRANSFER_CLUSTER_ID,
  internalTransferAssignment,
  unanimousPriorCategoryForGroup,
  type Assignment,
} from './assignment';

export { buildNewImportInputs } from './assignment';

export type ClusterPipelineResult = {
  sources: SourceRow[];
  assignments: Assignment[];
  clusterSuggestions: Map<string, CategorySuggestion>;
  /** §7 — `previousCategoryId` per minted `cluster_id` from physical groups. */
  clusterHints: Record<string, { previousCategoryId: string | null }>;
  /** Same ordering as the first `existing.length` entries in `sources` / `assignments`. */
  existingSorted: TransactionRecord[];
};

export type ClusterPipelineOpts = Readonly<{
  /** §4.2 stages **5–7** — full row list with clusterable flags. */
  planningRows: readonly PlanningRow[];
  /**
   * Test-only: skip DBSCAN and use these labels for clusterable sources
   * (existing clusterable rows first, then new clusterable rows in parse order).
   * DBSCAN noise (`-1`) is always split into singleton groups via `splitNoiseLabels`.
   */
  physicalGroupLabels?: readonly number[];
}>;

function planningRowToSourceRow(row: PlanningRow): SourceRow {
  if (row.kind === 'existing') {
    return { kind: 'existing', record: row.record };
  }
  return { kind: 'new', row: row.row, id: row.id };
}

function existingSortedFromPlanningRows(
  rows: readonly PlanningRow[],
): TransactionRecord[] {
  return map(
    filter(rows, (r): r is Extract<PlanningRow, { kind: 'existing' }> =>
      r.kind === 'existing',
    ),
    (r) => r.record,
  );
}

/** Align clusterable assignments back onto the full planning row list via `zipWith`. */
function assignmentsForPlanningRows(
  planningRows: readonly PlanningRow[],
  clusterableAssignments: Assignment[],
): Assignment[] {
  const clusterable = clusterableRows(planningRows);
  if (clusterable.length !== clusterableAssignments.length) {
    throw new Error(
      'assignmentsForPlanningRows: clusterable assignment count mismatch',
    );
  }

  const assignById = new Map(
    zipWith(clusterable, clusterableAssignments, (row, assign) => [row.id, assign] as const),
  );

  const internalAssign = internalTransferAssignment();
  return map(planningRows, (row) =>
    row.clusterable ? assignById.get(row.id)! : internalAssign,
  );
}

/**
 * Cluster and categorize **clusterable** sources only (caller excludes paired transfer legs).
 *
 * Returns one assignment per input source plus cluster-level suggestion and hint maps keyed
 * by minted `cluster_id` (`previousCategoryId` is the unanimous prior category on existing
 * members, if any).
 */
export async function runClusterAndCategoryPipeline(
  embedder: MerchantEmbedder,
  opts: ClusterPipelineOpts,
): Promise<ClusterPipelineResult> {
  const planningRows = opts.planningRows;
  const existingSorted = existingSortedFromPlanningRows(planningRows);
  const sourcesFull = map(planningRows, planningRowToSourceRow);
  const sourcesClusterable = map(clusterableRows(planningRows), planningRowToSourceRow);

  let clusterSuggestions: Map<string, CategorySuggestion>;
  let assignmentsFull: Assignment[];
  let clusterHints: Record<string, { previousCategoryId: string | null }> = {};

  if (sourcesClusterable.length === 0) {
    clusterSuggestions = new Map();
    const internalAssign = internalTransferAssignment();
    assignmentsFull = sourcesFull.map(() => internalAssign);
  } else {
    const inner = await runClusterPass(
      sourcesClusterable,
      embedder,
      opts.physicalGroupLabels,
    );
    clusterSuggestions = inner.clusterSuggestions;
    clusterHints = inner.clusterHints;
    assignmentsFull = assignmentsForPlanningRows(planningRows, inner.assignments);
  }

  return {
    sources: sourcesFull,
    assignments: assignmentsFull,
    clusterSuggestions,
    clusterHints,
    existingSorted,
  };
}

/** §7.4: cluster ids present before import on some transaction but in none after. */
export function computeRetiredClusterIds(
  existing: TransactionRecord[],
  assignments: Assignment[],
): string[] {
  const before = uniq(compact(map(existing, 'cluster_id')));
  const after = uniq(map(assignments, 'cluster_id'));
  return difference(before, after);
}
