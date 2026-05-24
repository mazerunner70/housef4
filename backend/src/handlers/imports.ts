import { getFinanceRepository } from '@housef4/db';

import { HttpError } from '../httpError';
import {
  executeImportOrchestration,
} from '../services/import/importOrchestration';
import {
  extractImportMultipart,
  MultipartFileTooLargeError,
} from '../services/import/ingress/multipartFile';
import { createImportStageTracer } from '../services/import/importStageTracing';
import type { InternalRequest } from '../types';

/**
 * POST /api/imports — thin HTTP shell; pipeline stages §4.2 in
 * `docs/03_detailed_design/import_transaction_files.md` run in
 * `executeImportOrchestration`.
 */
export async function postImportPayload(
  userId: string,
  req: InternalRequest,
): Promise<Record<string, unknown>> {
  const buf = req.bodyBuffer;
  if (!buf?.length) {
    throw new HttpError(400, 'Request body is empty');
  }

  const tracer = createImportStageTracer({ userId });

  // §4.2 stage 1 — Ingress (`extractImportMultipart`).
  let extracted;
  try {
    extracted = await tracer.run('1', () =>
      extractImportMultipart(req.headers, buf),
    );
  } catch (e) {
    tracer.emitSummary('error');
    if (e instanceof MultipartFileTooLargeError) {
      throw new HttpError(413, e.message, {
        error: 'Import file exceeds maximum size',
        max_bytes: e.maxBytes,
        field: e.fieldName,
      });
    }
    throw e;
  }
  if (!extracted?.file.buffer.length) {
    tracer.emitSummary('error');
    throw new HttpError(
      400,
      'Expected multipart/form-data with a non-empty part named "file"',
    );
  }

  const repo = getFinanceRepository();

  return executeImportOrchestration({ userId, repo, extracted, tracer });
}
