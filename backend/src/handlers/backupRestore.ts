import {
  BackupRestoreClientError,
  getFinanceRepository,
  RestoreLockConflictError,
  validateBackupSnapshotForRestore,
} from '@housef4/db';

import { extractBackupMultipart } from '../services/import/multipartFile';
import { HttpError } from '../httpError';
import { getLog } from '../requestLogContext';
import type { InternalRequest } from '../types';

export async function postBackupRestorePayload(
  userId: string,
  req: InternalRequest,
): Promise<Record<string, unknown>> {
  const log = getLog();
  const buf = req.bodyBuffer;
  if (!buf?.length) {
    throw new HttpError(400, 'Request body is empty');
  }

  const part = await extractBackupMultipart(req.headers, buf);
  if (!part?.buffer.length) {
    throw new HttpError(
      400,
      'Expected multipart/form-data with a non-empty part named "backup"',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(part.buffer.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Backup JSON is malformed');
  }

  let snapshot;
  try {
    snapshot = validateBackupSnapshotForRestore(userId, parsed);
  } catch (e) {
    if (e instanceof BackupRestoreClientError) {
      throw new HttpError(e.statusCode, e.message, e.body);
    }
    throw e;
  }

  const repo = getFinanceRepository();
  try {
    const restored = await repo.restoreBackupSnapshot(userId, snapshot);
    const completed_at = Date.now();
    log.info('backup.restore.ok', {
      userIdLen: userId.length,
      transactions: restored.transactions,
    });
    return {
      success: true,
      restored,
      completed_at,
    };
  } catch (e) {
    if (e instanceof RestoreLockConflictError) {
      throw new HttpError(409, 'Restore already in progress', {
        error: 'Restore already in progress',
      });
    }
    throw e;
  }
}
