/**
 * Per-stage duration + outcome tracing for import orchestration (§4.2, §11.2).
 *
 * Naming and CloudWatch query examples: `docs/03_detailed_design/import_observability.md`.
 */

import type { Logger } from '../../logger';
import { getLog } from '../../requestLogContext';
import { emitImportCloudWatchMetrics } from '../../observability/importMetrics';

/** §4.2 numbered stages (including **2b** duplicate blob guard). */
export const IMPORT_STAGE_IDS = [
  '1',
  '2',
  '2b',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
] as const;

export type ImportStageId = (typeof IMPORT_STAGE_IDS)[number];

export type ImportStageOutcome = 'ok' | 'error' | 'skipped';

type StageAccumulator = {
  durationMs: number;
  outcome: ImportStageOutcome;
  skipReason?: string;
};

export type ImportStageTracerContext = Readonly<{
  userId: string;
  importFileId?: string;
  rowCount?: number;
  staging?: boolean;
}>;

export type ImportStageTracer = Readonly<{
  setContext: (partial: Partial<ImportStageTracerContext>) => void;
  run: <T>(
    stage: ImportStageId,
    fn: () => T | Promise<T>,
    fields?: Record<string, unknown>,
  ) => Promise<T>;
  markSkipped: (stage: ImportStageId, reason?: string) => void;
  emitSummary: (
    outcome: 'ok' | 'error',
    extra?: Record<string, unknown>,
  ) => void;
  failedStage?: ImportStageId;
}>;

function mergeOutcome(
  prev: ImportStageOutcome,
  next: ImportStageOutcome,
): ImportStageOutcome {
  if (prev === 'error' || next === 'error') return 'error';
  if (prev === 'skipped' && next === 'skipped') return 'skipped';
  return 'ok';
}

function mergeStageRecord(
  stages: Map<ImportStageId, StageAccumulator>,
  stage: ImportStageId,
  record: StageAccumulator,
): void {
  const prev = stages.get(stage);
  if (!prev) {
    stages.set(stage, record);
    return;
  }
  stages.set(stage, {
    durationMs: prev.durationMs + record.durationMs,
    outcome: mergeOutcome(prev.outcome, record.outcome),
    skipReason: record.skipReason ?? prev.skipReason,
  });
}

export function createImportStageTracer(
  initial: ImportStageTracerContext,
  log: Logger = getLog(),
): ImportStageTracer {
  const context: ImportStageTracerContext = { ...initial };
  const stages = new Map<ImportStageId, StageAccumulator>();
  const startedAt = Date.now();
  let failedStage: ImportStageId | undefined;

  const tracer: ImportStageTracer = {
    get failedStage() {
      return failedStage;
    },
    setContext(partial) {
      Object.assign(context, partial);
    },
    async run(stage, fn, fields) {
      const t0 = Date.now();
      try {
        const result = await fn();
        const durationMs = Date.now() - t0;
        mergeStageRecord(stages, stage, { durationMs, outcome: 'ok' });
        log.debug('import.stage', {
          stage,
          outcome: 'ok',
          durationMs,
          userId: context.userId,
          ...(context.importFileId && { importFileId: context.importFileId }),
          ...fields,
        });
        return result;
      } catch (e) {
        const durationMs = Date.now() - t0;
        failedStage = stage;
        mergeStageRecord(stages, stage, { durationMs, outcome: 'error' });
        log.warn('import.stage', {
          stage,
          outcome: 'error',
          durationMs,
          userId: context.userId,
          ...(context.importFileId && { importFileId: context.importFileId }),
          errorName: e instanceof Error ? e.name : 'Error',
          ...fields,
        });
        throw e;
      }
    },
    markSkipped(stage, reason) {
      mergeStageRecord(stages, stage, {
        durationMs: 0,
        outcome: 'skipped',
        skipReason: reason,
      });
    },
    emitSummary(outcome, extra) {
      const stageSummary: Record<string, StageAccumulator> = {};
      for (const id of IMPORT_STAGE_IDS) {
        const record = stages.get(id);
        if (record) stageSummary[id] = record;
      }
      const totalDurationMs = Date.now() - startedAt;
      log.info('import.stages.summary', {
        outcome,
        totalDurationMs,
        userId: context.userId,
        ...(context.importFileId && { importFileId: context.importFileId }),
        ...(context.rowCount !== undefined && { rowCount: context.rowCount }),
        ...(context.staging !== undefined && { staging: context.staging }),
        ...(failedStage && { failedStage }),
        stages: stageSummary,
        ...extra,
      });
      void emitImportCloudWatchMetrics({
        outcome,
        totalDurationMs,
        ...(context.rowCount !== undefined && { rowCount: context.rowCount }),
        ...(context.staging !== undefined && { staging: context.staging }),
        ...(failedStage && { failedStage }),
        stages: stageSummary,
      }).catch((err) => {
        log.warn('import.metrics.emf_failed', {
          errorName: err instanceof Error ? err.name : 'Error',
          ...(err instanceof Error && err.message && { message: err.message }),
        });
      });
    },
  };

  return tracer;
}
