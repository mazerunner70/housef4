/**
 * §4.2 stage 9 — pure assembly of `PersistPlan` from cluster pipeline output.
 */

import type {
  ExistingTransactionPatch,
  ImportTransactionInput,
  TransactionRecord,
  TransferPairingAssignment,
} from '@housef4/db';

import {
  computeRetiredClusterIds,
  type Assignment,
} from '../clustering';
import type { ClusterPipelineResult } from '../clustering/clusterPipeline';
import type { SourceRow } from '../clustering/clusterPass';
import { cleanMerchantForClustering } from '../clustering/merchantNormalize';
import { parsedRowAmounts } from '../parse/parsedRowAmounts';
import {
  countBy,
  filter,
  flow,
  isEqual,
  map,
  pick,
  reject,
  uniq,
  zipStrict,
} from '../utils/lodashImport';
import type { PersistPlan } from './persistPlan';

function embeddingsNearEqual(
  a: number[] | undefined,
  b: number[] | Float32Array,
): boolean {
  const emb = Array.isArray(b) ? b : Array.from(b);
  if ((a?.length ?? -1) !== emb.length) return false;
  if (!a) return false;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = emb[i];
    if (av === undefined || bv === undefined) return false;
    if (Math.abs(av - bv) > 1e-4) return false;
  }
  return true;
}

function pairingPatchDelta(
  old: TransactionRecord,
  pairing?: TransferPairingAssignment,
): Partial<
  Pick<
    ExistingTransactionPatch,
    'pairing_id' | 'pairing_source' | 'pairing_confidence'
  >
> {
  if (!pairing) return {};
  if (
    old.pairing_id === pairing.pairing_id &&
    old.pairing_source === pairing.pairing_source &&
    old.pairing_confidence === pairing.pairing_confidence
  ) {
    return {};
  }
  return {
    pairing_id: pairing.pairing_id,
    pairing_source: pairing.pairing_source,
    pairing_confidence: pairing.pairing_confidence,
  };
}

type ExistingAssignmentPair = Readonly<{
  old: TransactionRecord;
  a: Assignment;
  pairing?: TransferPairingAssignment;
}>;

const ASSIGNMENT_COMPARE_KEYS = ['cluster_id', 'category', 'status'] as const;

function rowUnchanged({ old, a, pairing }: ExistingAssignmentPair): boolean {
  const pairingExtras = pairingPatchDelta(old, pairing);
  const hasPairingUpdate = Object.keys(pairingExtras).length > 0;
  return (
    isEqual(
      pick(old, ASSIGNMENT_COMPARE_KEYS),
      pick(a, ASSIGNMENT_COMPARE_KEYS),
    ) &&
    embeddingsNearEqual(old.merchant_embedding, a.embedding) &&
    !hasPairingUpdate
  );
}

function toExistingPatch({ old, a, pairing }: ExistingAssignmentPair): ExistingTransactionPatch {
  const cleaned =
    old.cleaned_merchant ?? cleanMerchantForClustering(old.raw_merchant);
  const emb = Array.from(a.embedding);
  const pairingExtras = pairingPatchDelta(old, pairing);
  return {
    id: old.id,
    cluster_id: a.cluster_id,
    category: a.category,
    status: a.status,
    cleaned_merchant: cleaned,
    merchant_embedding: emb,
    suggested_category: a.suggested_category,
    category_confidence: a.category_confidence,
    match_type: a.match_type,
    ...pairingExtras,
  };
}

/** Patches for existing ledger rows whose cluster/category/embedding/pairing changed. */
export function patchesForChangedRows(
  existingSorted: TransactionRecord[],
  assignments: Assignment[],
  pairingByLegId?: Readonly<Record<string, TransferPairingAssignment>>,
): ExistingTransactionPatch[] {
  const pairs: ExistingAssignmentPair[] = map(
    zipStrict(existingSorted, assignments.slice(0, existingSorted.length)),
    ([old, a]) => ({
      old,
      a,
      pairing: pairingByLegId?.[old.id],
    }),
  );

  return flow(
    (rows: ExistingAssignmentPair[]) => rows,
    (rows) => reject(rows, rowUnchanged),
    (rows) => map(rows, toExistingPatch),
  )(pairs);
}

/** New-file rows mapped to `ImportTransactionInput` (stage 9 inserts). */
export function insertsFromNewRows(
  userId: string,
  sources: SourceRow[],
  assignments: Assignment[],
  parsedLength: number,
  importCurrency: string,
  pairingByLegId?: Readonly<Record<string, TransferPairingAssignment>>,
): ImportTransactionInput[] {
  const nExisting = sources.length - parsedLength;
  const newRows = map(
    filter(
      zipStrict(sources.slice(nExisting), assignments.slice(nExisting)),
      (pair): pair is [Extract<SourceRow, { kind: 'new' }>, Assignment] =>
        pair[0].kind === 'new',
    ),
    ([s, a]) => {
      const row = s.row;
      const pairing = pairingByLegId?.[s.id];
      const amounts = parsedRowAmounts(row, importCurrency);
      return {
        user_id: userId,
        id: s.id,
        date: row.date,
        raw_merchant: row.raw_merchant,
        cleaned_merchant: cleanMerchantForClustering(row.raw_merchant),
        canonicalAmount: amounts.canonicalAmount,
        fileAmount: amounts.fileAmount,
        cluster_id: a.cluster_id,
        category: a.category,
        status: a.status,
        is_recurring: false,
        known_merchant: a.known_merchant,
        suggested_category: a.suggested_category,
        category_confidence: a.category_confidence,
        match_type: a.match_type,
        merchant_embedding: Array.from(a.embedding),
        ...(pairing && {
          pairing_id: pairing.pairing_id,
          pairing_source: pairing.pairing_source,
          pairing_confidence: pairing.pairing_confidence,
        }),
      };
    },
  );
  return newRows;
}

/** Roll-up counts for stage 9 summary (known/unknown merchants, clusters touched). */
export function summarizeInserts(
  toInsert: ImportTransactionInput[],
  importRowCount: number,
): PersistPlan['summary'] {
  const counts = countBy(toInsert, (r) => (r.known_merchant ? 'known' : 'unknown'));
  return {
    importRowCount,
    knownMerchants: counts.known ?? 0,
    unknownMerchants: counts.unknown ?? 0,
    newClustersTouched: uniq(map(toInsert, 'cluster_id')).length,
  };
}

export type BuildPersistPlanParams = Readonly<{
  userId: string;
  parsedLength: number;
  existing: TransactionRecord[];
  pairingByLegId: Readonly<Record<string, TransferPairingAssignment>>;
  pipeline: ClusterPipelineResult;
  importCurrency: string;
}>;

/** §4.2 stage 9 — assemble planning output from stages 7–8 artefacts. */
export function buildPersistPlan(params: BuildPersistPlanParams): PersistPlan {
  const { userId, parsedLength, existing, pairingByLegId, pipeline } = params;
  const { sources, assignments, existingSorted, clusterHints } = pipeline;

  const existingPatches = patchesForChangedRows(
    existingSorted,
    assignments,
    pairingByLegId,
  );
  const toInsert = insertsFromNewRows(
    userId,
    sources,
    assignments,
    parsedLength,
    params.importCurrency,
    pairingByLegId,
  );
  const retiredClusterIds = computeRetiredClusterIds(existing, assignments);
  const summary = summarizeInserts(toInsert, parsedLength);

  return {
    toInsert,
    existingPatches,
    retiredClusterIds,
    clusterHints,
    summary,
  };
}
