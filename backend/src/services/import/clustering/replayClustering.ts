import type { FinanceRepository, TransactionRecord } from '@housef4/db';

import { buildPlanningRows } from '../planning/planningRows';
import { buildLedgerSnapshot } from '../planning/ledgerSnapshot';
import {
  DBSCAN_EPS,
  DBSCAN_MIN_SAMPLES,
} from './labelGroups';
import {
  loadMerchantStringMatchConfig,
  type MerchantStringMatchConfig,
} from './merchantStringMatch';
import {
  createMerchantEmbedder,
  type MerchantEmbedder,
} from './merchantsEmbedder';
import {
  INTERNAL_TRANSFER_CLUSTER_ID,
  runClusterAndCategoryPipeline,
  type Assignment,
} from './clusterPipeline';
import { cleanMerchantForClustering } from './merchantNormalize';

export type ReplayFilters = Readonly<{
  txnIds?: ReadonlySet<string>;
  /** Case-insensitive substring match on raw or cleaned merchant (output filter only). */
  merchantSubstring?: string;
  /** When true, omit rows where replay matches stored category fields. */
  diffsOnly?: boolean;
}>;

export type ReplayRowStored = Readonly<{
  cleaned_merchant: string | null;
  cluster_id: string | null;
  category: string;
  status: string;
  suggested_category: string | null;
  match_type: string | null;
  category_confidence: number | null;
  pairing_id: string | null;
}>;

export type ReplayRowReplayed = Readonly<{
  cleaned_merchant: string;
  physical_group_label: number | null;
  physical_group_size: number;
  prior_cluster_ids: readonly string[];
  cluster_id: string;
  category: string;
  status: string;
  suggested_category: string | null;
  match_type: string;
  category_confidence: number;
  skipped_clustering: boolean;
}>;

export type ReplayRowDiff = Readonly<{
  cleaned_merchant: boolean;
  category: boolean;
  status: boolean;
  suggested_category: boolean;
  match_type: boolean;
  /** Stored cluster membership vs replay physical group (ignores uuid remint). */
  grouping: boolean;
}>;

export type ReplayRow = Readonly<{
  id: string;
  date: number;
  raw_merchant: string;
  stored: ReplayRowStored;
  replay: ReplayRowReplayed;
  differs: ReplayRowDiff;
}>;

export type ReplayMeta = Readonly<{
  user_id: string;
  generated_at: string;
  corpus_transaction_count: number;
  clusterable_transaction_count: number;
  output_row_count: number;
  embedder_uses_model: boolean;
  dbscan_eps: number;
  dbscan_min_samples: number;
  merchant_string_match_mode: string;
  merchant_string_match_max_distance: number;
  note: string;
}>;

export type ReplayResult = Readonly<{
  meta: ReplayMeta;
  rows: ReplayRow[];
}>;

export type ReplayClusteringOpts = Readonly<{
  userId: string;
  repo: FinanceRepository;
  embedder?: MerchantEmbedder;
  filters?: ReplayFilters;
  merchantStringMatch?: MerchantStringMatchConfig;
}>;

function storedFields(record: TransactionRecord): ReplayRowStored {
  return {
    cleaned_merchant: record.cleaned_merchant ?? null,
    cluster_id: record.cluster_id ?? null,
    category: record.category,
    status: record.status,
    suggested_category: record.suggested_category ?? null,
    match_type: record.match_type ?? null,
    category_confidence: record.category_confidence ?? null,
    pairing_id: record.pairing_id ?? null,
  };
}

function assignmentToReplay(
  assignment: Assignment,
  cleaned: string,
  physicalGroupLabel: number | null,
  physicalGroupSize: number,
  priorClusterIds: readonly string[],
  skippedClustering: boolean,
): ReplayRowReplayed {
  return {
    cleaned_merchant: cleaned,
    physical_group_label: physicalGroupLabel,
    physical_group_size: physicalGroupSize,
    prior_cluster_ids: priorClusterIds,
    cluster_id: assignment.cluster_id,
    category: assignment.category,
    status: assignment.status,
    suggested_category: assignment.suggested_category,
    match_type: assignment.match_type,
    category_confidence: assignment.category_confidence,
    skipped_clustering: skippedClustering,
  };
}

function normalizeOptionalString(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function differsBetween(
  stored: ReplayRowStored,
  replay: ReplayRowReplayed,
  groupingChanged: boolean,
  rawMerchant: string,
): ReplayRowDiff {
  const expectedCleaned =
    stored.cleaned_merchant ?? cleanMerchantForClustering(rawMerchant);
  return {
    cleaned_merchant: expectedCleaned !== replay.cleaned_merchant,
    category: stored.category !== replay.category,
    status: stored.status !== replay.status,
    suggested_category:
      normalizeOptionalString(stored.suggested_category) !==
      normalizeOptionalString(replay.suggested_category),
    match_type:
      normalizeOptionalString(stored.match_type) !==
      normalizeOptionalString(replay.match_type),
    grouping: groupingChanged,
  };
}

/** Rows whose stored cluster split/merged vs replay physical groups. */
function groupingChangedIds(rows: ReplayRow[]): Set<string> {
  const labelsByStoredCluster = new Map<string, Set<number>>();
  const storedClustersByLabel = new Map<number, Set<string>>();
  const rowIdsByStoredCluster = new Map<string, string[]>();
  const rowIdsByLabel = new Map<number, string[]>();

  for (const row of rows) {
    const storedCluster = row.stored.cluster_id;
    const label = row.replay.physical_group_label;
    if (!storedCluster || label === null || row.replay.skipped_clustering) continue;

    let labelSet = labelsByStoredCluster.get(storedCluster);
    if (!labelSet) {
      labelSet = new Set();
      labelsByStoredCluster.set(storedCluster, labelSet);
    }
    labelSet.add(label);

    let clusterSet = storedClustersByLabel.get(label);
    if (!clusterSet) {
      clusterSet = new Set();
      storedClustersByLabel.set(label, clusterSet);
    }
    clusterSet.add(storedCluster);

    rowIdsByStoredCluster.set(storedCluster, [
      ...(rowIdsByStoredCluster.get(storedCluster) ?? []),
      row.id,
    ]);
    rowIdsByLabel.set(label, [...(rowIdsByLabel.get(label) ?? []), row.id]);
  }

  const changed = new Set<string>();
  for (const [storedCluster, labels] of labelsByStoredCluster) {
    if (labels.size > 1) {
      for (const id of rowIdsByStoredCluster.get(storedCluster) ?? []) {
        changed.add(id);
      }
    }
  }
  for (const [label, clusters] of storedClustersByLabel) {
    if (clusters.size > 1) {
      for (const id of rowIdsByLabel.get(label) ?? []) {
        changed.add(id);
      }
    }
  }
  return changed;
}

function passesFilters(
  row: ReplayRow,
  filters: ReplayFilters | undefined,
): boolean {
  if (!filters) return true;
  if (filters.txnIds && !filters.txnIds.has(row.id)) return false;
  if (filters.merchantSubstring) {
    const needle = filters.merchantSubstring.toLowerCase();
    const hay = `${row.raw_merchant}\n${row.stored.cleaned_merchant ?? ''}\n${row.replay.cleaned_merchant}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (filters.diffsOnly) {
    const d = row.differs;
    if (
      !d.cleaned_merchant &&
      !d.category &&
      !d.status &&
      !d.suggested_category &&
      !d.match_type &&
      !d.grouping
    ) {
      return false;
    }
  }
  return true;
}

/** Re-run clustering on the user's full DynamoDB ledger (read-only). */
export async function replayClusteringForUser(
  opts: ReplayClusteringOpts,
): Promise<ReplayResult> {
  const { userId, repo, filters } = opts;
  const embedder = opts.embedder ?? (await createMerchantEmbedder());
  const stringMatch = opts.merchantStringMatch ?? loadMerchantStringMatchConfig();

  const snapshot = await buildLedgerSnapshot(userId, repo);
  const existing = snapshot.transactions;
  /** Recompute normalizer output from raw (ignore stale stored cleaned_merchant). */
  const existingForPipeline = existing.map((t) => ({
    ...t,
    cleaned_merchant: undefined,
  }));

  const pairedTxnIds = new Set<string>();
  for (const t of existing) {
    if (t.pairing_id) pairedTxnIds.add(t.id);
  }

  const planningRows = buildPlanningRows(existingForPipeline, [], [], pairedTxnIds);
  const pipeline = await runClusterAndCategoryPipeline(embedder, {
    planningRows,
    merchantStringMatch: stringMatch,
  });

  const clusterable = planningRows.filter((r) => r.clusterable);
  const debug = pipeline.clusterPassDebug;

  const physicalLabelByClusterableIndex = debug?.physicalGroupLabels ?? [];
  const cleanedByClusterableIndex = debug?.cleanedTexts ?? [];
  const labelResolution = debug?.labelResolution ?? new Map();

  const groupSizeByLabel = new Map<number, number>();
  for (const label of physicalLabelByClusterableIndex) {
    groupSizeByLabel.set(label, (groupSizeByLabel.get(label) ?? 0) + 1);
  }

  let clusterableIdx = 0;
  const allRows: ReplayRow[] = [];

  for (let i = 0; i < planningRows.length; i++) {
    const planRow = planningRows[i]!;
    const assignment = pipeline.assignments[i]!;
    const record = existing.find((t) => t.id === planRow.id);
    if (!record) {
      throw new Error(`replayClusteringForUser: missing record ${planRow.id}`);
    }

    const skippedClustering =
      assignment.cluster_id === INTERNAL_TRANSFER_CLUSTER_ID;

    let physicalLabel: number | null = null;
    let cleaned = cleanMerchantForClustering(record.raw_merchant);
    let priorClusterIds: readonly string[] = [];
    let physicalGroupSize = 1;

    if (!skippedClustering) {
      physicalLabel = physicalLabelByClusterableIndex[clusterableIdx] ?? null;
      cleaned = cleanedByClusterableIndex[clusterableIdx] ?? cleaned;
      if (physicalLabel !== null) {
        priorClusterIds =
          labelResolution.get(physicalLabel)?.prior_cluster_ids ?? [];
        physicalGroupSize = groupSizeByLabel.get(physicalLabel) ?? 1;
      }
      clusterableIdx += 1;
    }

    const stored = storedFields(record);
    const replay = assignmentToReplay(
      assignment,
      cleaned,
      physicalLabel,
      physicalGroupSize,
      priorClusterIds,
      skippedClustering,
    );

    allRows.push({
      id: record.id,
      date: record.date,
      raw_merchant: record.raw_merchant,
      stored,
      replay,
      differs: differsBetween(stored, replay, false, record.raw_merchant),
    });
  }

  const groupingChanged = groupingChangedIds(allRows);
  const rowsWithDiffs = allRows.map((row) => ({
    ...row,
    differs: differsBetween(
      row.stored,
      row.replay,
      groupingChanged.has(row.id),
      row.raw_merchant,
    ),
  }));

  const rows = rowsWithDiffs.filter((row) => passesFilters(row, filters));

  return {
    meta: {
      user_id: userId,
      generated_at: new Date().toISOString(),
      corpus_transaction_count: existing.length,
      clusterable_transaction_count: clusterable.length,
      output_row_count: rows.length,
      embedder_uses_model: embedder.usesModel,
      dbscan_eps: DBSCAN_EPS,
      dbscan_min_samples: DBSCAN_MIN_SAMPLES,
      merchant_string_match_mode: stringMatch.mode,
      merchant_string_match_max_distance: stringMatch.maxDistance,
      note:
        'Replay remints cluster_id (CL_uuid) each run — compare physical_group_label and category fields, not replay.cluster_id vs stored.cluster_id.',
    },
    rows,
  };
}

/** JSON-safe shape (Maps → plain objects). */
export function serializeReplayResult(result: ReplayResult): string {
  return JSON.stringify(result, null, 2);
}
