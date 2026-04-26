import { getAccountsPayload } from './handlers/accounts';
import { getHealthPayload } from './handlers/health';
import { postImportPayload } from './handlers/imports';
import { getMePayload } from './handlers/me';
import { getMetricsPayload } from './handlers/metrics';
import { getReviewQueuePayload } from './handlers/reviewQueue';
import { getTransactionFilesPayload } from './handlers/transactionFiles';
import { postTagRulePayload } from './handlers/tagRule';
import { getTransactionsPayload } from './handlers/transactions';
import { HttpError } from './httpError';
import { normalizeApiPath } from './pathNormalize';
import { getLog } from './requestLogContext';
import type { InternalRequest, InternalResponse } from './types';

function isHealthPath(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return (
    segments[apiIdx + 1] === 'health' && apiIdx + 2 === segments.length
  );
}

function isMePath(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return segments[apiIdx + 1] === 'me' && apiIdx + 2 === segments.length;
}

function isMetricsPath(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return (
    segments[apiIdx + 1] === 'metrics' && apiIdx + 2 === segments.length
  );
}

function isAccountsPath(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return false;
  return (
    segments[apiIdx + 1] === 'accounts' && apiIdx + 2 === segments.length
  );
}

/** Path segments after `/api/` for the normalized path (e.g. `['rules','tag']`). */
function apiRouteTail(normalizedPath: string): string[] {
  const pathname = normalizedPath.split('?')[0] ?? '';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const apiIdx = segments.indexOf('api');
  if (apiIdx < 0) return [];
  return segments.slice(apiIdx + 1);
}

function matchesApiTail(normalizedPath: string, tail: string[]): boolean {
  const t = apiRouteTail(normalizedPath);
  return t.length === tail.length && tail.every((seg, i) => t[i] === seg);
}

/** True for `/api/...` routes that are not public (health). Matches API Gateway JWT on `ANY /api/{proxy+}`. */
function requiresAuthenticatedApiUser(normalizedPath: string): boolean {
  const pathname = normalizedPath.split('?')[0] ?? '';
  if (!pathname.startsWith('/api/')) return false;
  return !isHealthPath(normalizedPath);
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): InternalResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body,
  };
}

/**
 * Single application router. Lambda and local HTTP both call this with a normalized request.
 */
export async function dispatch(req: InternalRequest): Promise<InternalResponse> {
  const log = getLog();
  try {
    const method = req.method.toUpperCase();
    const path = normalizeApiPath(req.path);
    log.debug('dispatch.route', { method, path });

    if ((method === 'GET' || method === 'HEAD') && isHealthPath(path)) {
      const body = await getHealthPayload();
      log.info('dispatch.response', { route: 'health', statusCode: 200 });
      return jsonResponse(200, body);
    }

    if (requiresAuthenticatedApiUser(path)) {
      const uid = req.userId;
      if (!uid) {
        log.info('dispatch.unauthorized', { method, path });
        return jsonResponse(401, { error: 'Unauthorized' });
      }

      if (method === 'GET' && isMePath(path)) {
        log.info('dispatch.response', { route: 'me', statusCode: 200 });
        return jsonResponse(200, getMePayload(uid));
      }

      if (method === 'GET' && isMetricsPath(path)) {
        const body = await getMetricsPayload(uid);
        log.info('dispatch.response', { route: 'metrics', statusCode: 200 });
        return jsonResponse(200, body);
      }

      if (method === 'GET' && isAccountsPath(path)) {
        const body = await getAccountsPayload(uid);
        log.info('dispatch.response', { route: 'accounts', statusCode: 200 });
        return jsonResponse(200, body);
      }

      if (method === 'POST' && matchesApiTail(path, ['imports'])) {
        const body = await postImportPayload(uid, req);
        log.info('dispatch.response', { route: 'imports', statusCode: 200 });
        return jsonResponse(200, body);
      }

      if (method === 'GET' && matchesApiTail(path, ['transactions'])) {
        const transactionFileId =
          req.query?.transactionFileId?.trim() || undefined;
        const clusterId = req.query?.clusterId?.trim() || undefined;
        const body = await getTransactionsPayload(uid, {
          transactionFileId,
          clusterId,
        });
        log.info('dispatch.response', { route: 'transactions', statusCode: 200 });
        return jsonResponse(200, body);
      }

      if (method === 'GET' && matchesApiTail(path, ['review-queue'])) {
        const body = await getReviewQueuePayload(uid);
        log.info('dispatch.response', { route: 'review-queue', statusCode: 200 });
        return jsonResponse(200, body);
      }

      if (method === 'GET' && matchesApiTail(path, ['transaction-files'])) {
        const body = await getTransactionFilesPayload(uid);
        log.info('dispatch.response', { route: 'transaction-files', statusCode: 200 });
        return jsonResponse(200, body);
      }

      if (method === 'POST' && matchesApiTail(path, ['rules', 'tag'])) {
        const body = await postTagRulePayload(uid, req.rawBody);
        log.info('dispatch.response', { route: 'rules/tag', statusCode: 200 });
        return jsonResponse(200, body);
      }

      log.info('dispatch.notFound', { method, path, authenticated: true });
      return jsonResponse(404, { error: 'Not Found' });
    }

    log.info('dispatch.notFound', { method, path, authenticated: false });
    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    if (err instanceof HttpError) {
      log.info('dispatch.httpError', {
        statusCode: err.statusCode,
        message: err.message,
      });
      return jsonResponse(err.statusCode, err.body);
    }
    log.error('dispatch.error', {
      err: err instanceof Error ? err.message : String(err),
      errName: err instanceof Error ? err.name : undefined,
    });
    return jsonResponse(500, { error: 'Internal Server Error' });
  }
}
