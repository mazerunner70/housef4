import {
  getFinanceRepository,
  BackupRestoreClientError,
  RESTORE_ABORT_STAGING_CLEANUP_CODE,
  RestoreAbortStagingCleanupError,
  RestoreLockConflictError,
  validateBackupSnapshotForRestore,
} from '@housef4/db';

import {
  extractBackupMultipart,
  MultipartFileTooLargeError,
} from '../services/import/multipartFile';
import { HttpError } from '../httpError';
import { getLog } from '../requestLogContext';
import type { InternalRequest } from '../types';

function isRestoreAbortStagingCleanupError(
  e: unknown,
): e is RestoreAbortStagingCleanupError {
  if (e instanceof RestoreAbortStagingCleanupError) return true;
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === RESTORE_ABORT_STAGING_CLEANUP_CODE &&
    typeof (e as { restore_lock_cleared?: unknown }).restore_lock_cleared ===
      'boolean'
  );
}

export async function postBackupRestorePayload(
  userId: string,
  req: InternalRequest,
): Promise<Record<string, unknown>> {
  const log = getLog();
  const buf = req.bodyBuffer;
  if (!buf?.length) {
    throw new HttpError(400, 'Request body is empty');
  }

  let part;
  try {
    part = await extractBackupMultipart(req.headers, buf);
  } catch (e) {
    if (e instanceof MultipartFileTooLargeError) {
      throw new HttpError(400, e.message, {
        error: 'Backup file exceeds maximum size',
        max_bytes: e.maxBytes,
        field: e.fieldName,
      });
    }
    throw e;
  }
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
    log.error('backup.restore.handler_failed', {
      userIdLen: userId.length,
      err: e instanceof Error ? e.message : String(e),
    });
    throw new HttpError(500, 'Restore failed', { error: 'Restore failed' });
  }
}

export async function postBackupRestoreAbortPayload(
  userId: string,
): Promise<Record<string, unknown>> {
  const log = getLog();
  const repo = getFinanceRepository();
  try {
    const { restore_lock_cleared } = await repo.abortRestoreCleanup(userId);
    const completed_at = Date.now();
    log.info('backup.restore.abort.ok', {
      userIdLen: userId.length,
      restore_lock_cleared,
    });
    return {
      success: true,
      restore_lock_cleared,
      staging_partition_cleared: true,
      completed_at,
    };
  } catch (e) {
    if (isRestoreAbortStagingCleanupError(e)) {
      log.warn('backup.restore.abort.staging_failed', {
        userIdLen: userId.length,
        restore_lock_cleared: e.restore_lock_cleared,
      });
      throw new HttpError(500, 'Restore abort cleanup incomplete', {
        success: false,
        restore_lock_cleared: e.restore_lock_cleared,
        staging_partition_cleared: false,
        completed_at: Date.now(),
      });
    }
    throw e;
  }
}
