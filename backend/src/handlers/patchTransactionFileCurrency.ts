import { getFinanceRepository } from '@housef4/db';
import { z } from 'zod';

import { HttpError } from '../httpError';
import { getLog } from '../requestLogContext';

const patchBodySchema = z.object({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'),
  set_default_currency: z.boolean().optional(),
});

export async function patchTransactionFileCurrencyPayload(
  userId: string,
  importFileId: string,
  rawBody: string,
): Promise<{
  currency: string;
  transactions_updated: number;
  clusters_rebuilt: number;
  profile_default_updated: boolean;
}> {
  const log = getLog();
  const fileId = importFileId.trim();
  if (!fileId) {
    throw new HttpError(400, 'Missing transaction file id');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.length ? rawBody : '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  const body = patchBodySchema.safeParse(parsed);
  if (!body.success) {
    throw new HttpError(400, 'Invalid request body', {
      error: 'Validation failed',
      details: body.error.flatten(),
    });
  }

  const repo = getFinanceRepository();
  try {
    const result = await repo.patchTransactionFileCurrency(
      userId,
      fileId,
      body.data.currency,
      { setProfileDefault: body.data.set_default_currency === true },
    );
    log.info('transactionFile.currencyPatched', {
      importFileId: fileId,
      currency: result.currency,
      transactions_updated: result.transactions_updated,
      clusters_rebuilt: result.clusters_rebuilt,
      profile_default_updated: result.profile_default_updated,
    });
    return result;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Unknown transaction file')) {
      throw new HttpError(404, 'Transaction file not found');
    }
    if (e instanceof Error && e.message.includes('Invalid ISO 4217')) {
      throw new HttpError(400, 'Invalid currency code');
    }
    throw e;
  }
}
