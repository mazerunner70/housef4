/**
 * Shell helper — run an import stage with optional tracing.
 *
 * Replaces repeated `tracer?.run(stage, fn) ?? fn()` at orchestration boundaries.
 */

import type { ImportStageId, ImportStageTracer } from '../importStageTracing';

/** Run `fn` under stage tracing when `tracer` is present; otherwise invoke directly. */
export async function traceStage<T>(
  tracer: ImportStageTracer | undefined,
  stage: ImportStageId,
  fn: () => T | Promise<T>,
  fields?: Record<string, unknown>,
): Promise<T> {
  if (tracer) {
    return tracer.run(stage, fn, fields);
  }
  return fn();
}
