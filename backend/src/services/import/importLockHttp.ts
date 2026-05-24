import type { ImportLockConflictError } from '@housef4/db';

import { HttpError } from '../../httpError';

/** Maps {@link ImportLockConflictError} to **`409 Conflict`** per `api_contract.md`. */
export function importLockConflictHttpError(
  e: ImportLockConflictError,
): HttpError {
  const restore = e.reason === 'restore_in_progress';
  return new HttpError(
    409,
    restore ? 'Restore in progress; import blocked' : 'Import already in progress',
    {
      error: restore ? 'restore_in_progress' : 'import_in_progress',
      message: restore
        ? 'A backup restore is in progress. Wait for it to finish, then retry the import.'
        : 'Another import is in progress for this account. Wait for it to finish, then retry.',
    },
  );
}
