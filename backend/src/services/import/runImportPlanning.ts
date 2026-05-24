/**
 * Import planning orchestration (§4.2 stages 7–9).
 *
 * Stages 7–8 are read-only on Dynamo; stage 9 assembles an in-memory `PersistPlan`
 * consumed by `persistImportPlan` (stage 10). Transactional `cluster_id` values remint
 * per physical embedding group on each corpus pass (§6.0).
 */

import type {
  ExistingTransactionPatch,
  TransactionRecord,
  TransferPairingAssignment,
} from '@housef4/db';

import type { ParsedImportRow } from './parse/canonical';
import {
  buildNewImportInputs,
  computeRetiredClusterIds,
  runClusterAndCategoryPipeline,
  type Assignment,
} from './clusterPipeline';
import type { LedgerSnapshot } from './ledgerSnapshot';
import type { PersistPlan } from './persistPlan';
import type { ImportStageTracer } from './importStageTracing';
import { computeIngestTransferPairings } from '../pairing';
import { createMerchantEmbedder } from './merchantsEmbedder';
import { cleanMerchantForClustering } from './merchantNormalize';

export type ImportPlanningContext = Readonly<{
  /** Financial account this file is imported into (`ACCOUNT#…`). */
  importAccountId: string;
  /** ISO 4217 when known from the parsed file (transfer pairing only). */
  importCurrency?: string;
  /** §4.2 stage 5 output; `newTransactionIds[i]` ↔ `parsed[i]`. */
  newTransactionIds: readonly string[];
  /** §4.2 stage 6 output; required when `parsed.length > 0`. */
  ledgerSnapshot?: LedgerSnapshot;
  /** Optional §4.2 stages **7–9** timing (orchestration). */
  tracer?: ImportStageTracer;
  /**
   * Test-only: skip DBSCAN in stage 8; labels align with clusterable sources
   * (existing clusterable first, then new clusterable rows in parse order).
   * DBSCAN noise (`-1`) is split into singleton groups, matching production.
   */
  physicalGroupLabels?: readonly number[];
}>;

function embeddingsNearEqual(a: number[] | undefined, b: number[]): boolean {
  if ((a?.length ?? -1) !== b.length) return false;
  if (!a) return false;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
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

function buildExistingPatches(
  existingSorted: TransactionRecord[],
  assignments: Assignment[],
  pairingByLegId?: Readonly<Record<string, TransferPairingAssignment>>,
): ExistingTransactionPatch[] {
  const patches: ExistingTransactionPatch[] = [];
  for (let i = 0; i < existingSorted.length; i++) {
    const old = existingSorted[i];
    const a = assignments[i];
    if (old === undefined || a === undefined) {
      throw new Error('buildExistingPatches: misaligned existing vs assignments');
    }
    const cleaned =
      old.cleaned_merchant ?? cleanMerchantForClustering(old.raw_merchant);
    const emb = Array.from(a.embedding);
    const pairingExtras = pairingPatchDelta(old, pairingByLegId?.[old.id]);
    const hasPairingUpdate = Object.keys(pairingExtras).length > 0;
    if (
      old.cluster_id === a.cluster_id &&
      old.category === a.category &&
      old.status === a.status &&
      embeddingsNearEqual(old.merchant_embedding, emb) &&
      !hasPairingUpdate
    ) {
      continue;
    }
    patches.push({
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
    });
  }
  return patches;
}

/** §4.2 stage 9 — assemble planning output from stages 7–8 artefacts. */
function buildPersistPlan(
  userId: string,
  parsed: ParsedImportRow[],
  existing: TransactionRecord[],
  pairingByLegId: Readonly<Record<string, TransferPairingAssignment>>,
  pipeline: Awaited<ReturnType<typeof runClusterAndCategoryPipeline>>,
): PersistPlan {
  const { sources, assignments, existingSorted, clusterHints } = pipeline;

  const existingPatches = buildExistingPatches(
    existingSorted,
    assignments,
    pairingByLegId,
  );

  const toInsert = buildNewImportInputs(
    userId,
    sources,
    assignments,
    parsed.length,
    pairingByLegId,
  );

  const retiredClusterIds = computeRetiredClusterIds(existing, assignments);

  let knownMerchants = 0;
  let unknownMerchants = 0;
  for (const r of toInsert) {
    if (r.known_merchant) knownMerchants += 1;
    else unknownMerchants += 1;
  }

  const newClustersTouched = new Set(toInsert.map((r) => r.cluster_id)).size;

  return {
    toInsert,
    existingPatches,
    retiredClusterIds,
    clusterHints,
    summary: {
      importRowCount: parsed.length,
      knownMerchants,
      unknownMerchants,
      newClustersTouched,
    },
  };
}

const EMPTY_PLAN: PersistPlan = {
  toInsert: [],
  existingPatches: [],
  retiredClusterIds: [],
  clusterHints: {},
  summary: {
    importRowCount: 0,
    knownMerchants: 0,
    unknownMerchants: 0,
    newClustersTouched: 0,
  },
};

/**
 * §4.2 stages **7–9**: pairing → cluster/categorise → `PersistPlan`.
 *
 * Read-only on Dynamo (embedder init inside stage 8 may load a local model).
 */
export async function runImportPlanning(
  userId: string,
  parsed: ParsedImportRow[],
  ctx: ImportPlanningContext,
): Promise<PersistPlan> {
  if (parsed.length === 0) {
    return EMPTY_PLAN;
  }

  if (!ctx.ledgerSnapshot) {
    throw new Error('runImportPlanning: ledgerSnapshot required when parsed rows exist');
  }
  if (ctx.newTransactionIds.length !== parsed.length) {
    throw new Error(
      'runImportPlanning: newTransactionIds length must match parsed rows',
    );
  }

  const { transactions: existing, fileIdToAccountId } = ctx.ledgerSnapshot;
  const newTransactionIds = ctx.newTransactionIds;
  const tracer = ctx.tracer;

  // --- Stage 7: Transfer pairing (`transfer_matching.md`, ingest-scoped). ---
  const pairingByLegId = await (tracer?.run('7', async () =>
    computeIngestTransferPairings({
      importAccountId: ctx.importAccountId,
      importCurrency: ctx.importCurrency,
      parsed,
      newTransactionIds,
      existingTransactions: existing,
      fileIdToAccountId,
    }),
  ) ??
    Promise.resolve(
      computeIngestTransferPairings({
        importAccountId: ctx.importAccountId,
        importCurrency: ctx.importCurrency,
        parsed,
        newTransactionIds,
        existingTransactions: existing,
        fileIdToAccountId,
      }),
    ));
  /** `transfer_matching.md` §7: skip merchant clustering for any row already linked by `pairing_id`, not only legs paired this run. */
  const pairedTxnIds = new Set<string>(Object.keys(pairingByLegId));
  for (const t of existing) {
    if (t.pairing_id) pairedTxnIds.add(t.id);
  }

  // --- Stage 8: Cluster and categorise (embeddings + DBSCAN + category rules). ---
  const embedder = await createMerchantEmbedder();
  const pipeline = await (tracer?.run('8', () =>
    runClusterAndCategoryPipeline(existing, parsed, embedder, {
      newTransactionIds,
      pairedTxnIds,
      physicalGroupLabels: ctx.physicalGroupLabels,
    }),
  ) ??
    runClusterAndCategoryPipeline(existing, parsed, embedder, {
      newTransactionIds,
      pairedTxnIds,
      physicalGroupLabels: ctx.physicalGroupLabels,
    }));

  // --- Stage 9: Build persist plan (inserts, patches, retired clusters, summary). ---
  return (
    tracer?.run('9', async () =>
      buildPersistPlan(userId, parsed, existing, pairingByLegId, pipeline),
    ) ?? buildPersistPlan(userId, parsed, existing, pairingByLegId, pipeline)
  );
}
