/**
 * CloudWatch Metrics via EMF for import orchestration (Lambda only).
 *
 * Local dev (`APP_ENV=local` or unset without Lambda) is a no-op — structured logs
 * remain the observability path. See `docs/03_detailed_design/import_observability.md`.
 */

import { createMetricsLogger, Unit } from 'aws-embedded-metrics';

import { loadConfig } from '../config';
import type { ImportStageId } from '../services/import/importStageTracing';

export const IMPORT_METRICS_NAMESPACE = 'Housef4/Import';

export type ImportMetricsStageRecord = Readonly<{
  durationMs: number;
  outcome: 'ok' | 'error' | 'skipped';
}>;

export type EmitImportMetricsInput = Readonly<{
  outcome: 'ok' | 'error';
  totalDurationMs: number;
  rowCount?: number;
  staging?: boolean;
  failedStage?: ImportStageId;
  stages: Readonly<Record<string, ImportMetricsStageRecord>>;
}>;

/** True when EMF should be written (Lambda deploy; not local laptop). */
export function shouldEmitImportCloudWatchMetrics(): boolean {
  if (loadConfig().appEnv === 'local') return false;
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function stagingLabel(staging: boolean | undefined): string {
  if (staging === undefined) return 'unknown';
  return staging ? 'true' : 'false';
}

async function flushStageDuration(
  stage: string,
  record: ImportMetricsStageRecord,
  importOutcome: 'ok' | 'error',
  staging: boolean | undefined,
): Promise<void> {
  if (record.outcome === 'skipped') return;

  const metrics = createMetricsLogger();
  metrics.setNamespace(IMPORT_METRICS_NAMESPACE);
  metrics.putDimensions({
    Stage: stage,
    Outcome: importOutcome,
    Staging: stagingLabel(staging),
  });
  metrics.putMetric('ImportStageDurationMs', record.durationMs, Unit.Milliseconds);
  await metrics.flush();
}

/**
 * Publishes import timing metrics to CloudWatch via EMF (stdout). No-op in local dev.
 */
export async function emitImportCloudWatchMetrics(
  input: EmitImportMetricsInput,
): Promise<void> {
  if (!shouldEmitImportCloudWatchMetrics()) return;

  const staging = stagingLabel(input.staging);

  const summary = createMetricsLogger();
  summary.setNamespace(IMPORT_METRICS_NAMESPACE);
  summary.putDimensions({
    Outcome: input.outcome,
    Staging: staging,
  });
  summary.putMetric(
    'ImportTotalDurationMs',
    input.totalDurationMs,
    Unit.Milliseconds,
  );
  summary.putMetric('ImportCount', 1, Unit.Count);
  if (input.rowCount !== undefined) {
    summary.putMetric('ImportRowCount', input.rowCount, Unit.Count);
  }
  if (input.failedStage) {
    summary.setProperty('FailedStage', input.failedStage);
  }
  await summary.flush();

  for (const [stage, record] of Object.entries(input.stages)) {
    await flushStageDuration(stage, record, input.outcome, input.staging);
  }
}
