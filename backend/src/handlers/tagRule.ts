import { getFinanceRepository } from '@housef4/db';
import { z } from 'zod';

import { HttpError } from '../httpError';
import { getLog } from '../requestLogContext';

const tagRuleBodySchema = z.object({
  cluster_id: z.string().min(1),
  assigned_category: z.string().min(1),
});

export async function postTagRulePayload(
  userId: string,
  rawBody: string,
): Promise<{ success: boolean; updated_transactions: number }> {
  const log = getLog();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.length ? rawBody : '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  const body = tagRuleBodySchema.safeParse(parsed);
  if (!body.success) {
    throw new HttpError(400, 'Invalid request body', {
      error: 'Validation failed',
      details: body.error.flatten(),
    });
  }

  const updated = await getFinanceRepository().applyTagRule(
    userId,
    body.data.cluster_id,
    body.data.assigned_category,
  );
  log.info('tagRule.applied', {
    cluster_id: body.data.cluster_id,
    updated_transactions: updated,
  });
  return { success: true, updated_transactions: updated };
}
