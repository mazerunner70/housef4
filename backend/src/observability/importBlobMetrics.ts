/**
 * CloudWatch metric for non-fatal blob write failures (`import_file_blob_storage.md` §8).
 */

import { createMetricsLogger, Unit } from 'aws-embedded-metrics';

import { shouldEmitImportCloudWatchMetrics } from './importMetrics';
import { IMPORT_METRICS_NAMESPACE } from './importMetrics';

export type EmitImportBlobWriteFailedInput = Readonly<{
  importFileId: string;
  backend: string;
}>;

export async function emitImportBlobWriteFailedMetric(
  input: EmitImportBlobWriteFailedInput,
): Promise<void> {
  if (!shouldEmitImportCloudWatchMetrics()) return;

  const metrics = createMetricsLogger();
  metrics.setNamespace(IMPORT_METRICS_NAMESPACE);
  metrics.putDimensions({ Backend: input.backend });
  metrics.putMetric('ImportBlobWriteFailed', 1, Unit.Count);
  metrics.setProperty('ImportFileId', input.importFileId);
  await metrics.flush();
}
