/**
 * Import planning orchestration (§4.2 stages 7–9).
 *
 * Stages 7–8 are read-only on Dynamo; stage 9 assembles an in-memory `PersistPlan`
 * consumed by `persistImportPlan` (stage 10). Transactional `cluster_id` values remint
 * per physical embedding group on each corpus pass (§6.0).
 */

import type { ParsedImportRow } from './parse/canonical';
import {
  createMerchantEmbedder,
  runClusterAndCategoryPipeline,
  type MerchantEmbedder,
} from './clustering';
import { buildPersistPlan } from './planning/buildPersistPlan';
import type { LedgerSnapshot } from './planning/ledgerSnapshot';
import { buildPlanningRows } from './planning/planningRows';
import type { PersistPlan } from './planning/persistPlan';
import type { ImportStageTracer } from './importStageTracing';
import { traceStage } from './utils/traceStage';
import { computeIngestTransferPairings } from '../pairing';

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
   * Pre-built embedder for stage **8** (§4.7 Q3 — tests inject a stub;
   * production omits and uses `createMerchantEmbedder()`).
   */
  embedder?: MerchantEmbedder;
  /**
   * Test-only: skip DBSCAN in stage 8; labels align with clusterable sources
   * (existing clusterable first, then new clusterable rows in parse order).
   * DBSCAN noise (`-1`) is split into singleton groups, matching production.
   */
  physicalGroupLabels?: readonly number[];
}>;

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

  const pairingParams = {
    importAccountId: ctx.importAccountId,
    importCurrency: ctx.importCurrency,
    parsed,
    newTransactionIds,
    existingTransactions: existing,
    fileIdToAccountId,
  };

  // --- Stage 7: Transfer pairing (`transfer_matching.md`, ingest-scoped). ---
  const pairingByLegId = await traceStage(tracer, '7', () =>
    computeIngestTransferPairings(pairingParams),
  );

  /** `transfer_matching.md` §7: skip merchant clustering for any row already linked by `pairing_id`, not only legs paired this run. */
  const pairedTxnIds = new Set<string>(Object.keys(pairingByLegId));
  for (const t of existing) {
    if (t.pairing_id) pairedTxnIds.add(t.id);
  }

  const planningRows = buildPlanningRows(
    existing,
    parsed,
    newTransactionIds,
    pairedTxnIds,
  );

  // --- Stage 8: Cluster and categorise (embeddings + DBSCAN + category rules). ---
  const embedder = ctx.embedder ?? (await createMerchantEmbedder());
  const pipeline = await traceStage(tracer, '8', () =>
    runClusterAndCategoryPipeline(embedder, {
      planningRows,
      physicalGroupLabels: ctx.physicalGroupLabels,
    }),
  );

  // --- Stage 9: Build persist plan (inserts, patches, retired clusters, summary). ---
  const planParams = {
    userId,
    parsedLength: parsed.length,
    existing,
    pairingByLegId,
    pipeline,
  };
  return traceStage(tracer, '9', () => buildPersistPlan(planParams));
}
