import { getAccountsPayload } from './handlers/accounts';
import { getBackupExportPayload } from './handlers/backupExport';
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

interface AuthenticatedGetRoute {
  tail: string[];
  routeLog: string;
  handler: (uid: string, req: InternalRequest) => Promise<InternalResponse>;
}

const authenticatedGetRoutes: AuthenticatedGetRoute[] = [
  {
    tail: ['me'],
    routeLog: 'me',
    handler: async (uid) => jsonResponse(200, getMePayload(uid)),
  },
  {
    tail: ['metrics'],
    routeLog: 'metrics',
    handler: async (uid) =>
      jsonResponse(200, await getMetricsPayload(uid)),
  },
  {
    tail: ['accounts'],
    routeLog: 'accounts',
    handler: async (uid) =>
      jsonResponse(200, await getAccountsPayload(uid)),
  },
  {
    tail: ['transactions'],
    routeLog: 'transactions',
    handler: async (uid, req) => {
      const transactionFileId =
        req.query?.transactionFileId?.trim() || undefined;
      const clusterId = req.query?.clusterId?.trim() || undefined;
      const body = await getTransactionsPayload(uid, {
        transactionFileId,
        clusterId,
      });
      return jsonResponse(200, body);
    },
  },
  {
    tail: ['review-queue'],
    routeLog: 'review-queue',
    handler: async (uid) =>
      jsonResponse(200, await getReviewQueuePayload(uid)),
  },
  {
    tail: ['transaction-files'],
    routeLog: 'transaction-files',
    handler: async (uid) =>
      jsonResponse(200, await getTransactionFilesPayload(uid)),
  },
  {
    tail: ['backup', 'export'],
    routeLog: 'backup/export',
    handler: async (uid) => {
      const body = await getBackupExportPayload(uid);
      const filename = `housef4-backup-${body.exported_at}.json`;
      return jsonResponse(200, body, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
    },
  },
];

interface AuthenticatedPostRoute {
  tail: string[];
  routeLog: string;
  handler: (uid: string, req: InternalRequest) => Promise<InternalResponse>;
}

const authenticatedPostRoutes: AuthenticatedPostRoute[] = [
  {
    tail: ['imports'],
    routeLog: 'imports',
    handler: async (uid, req) =>
      jsonResponse(200, await postImportPayload(uid, req)),
  },
  {
    tail: ['rules', 'tag'],
    routeLog: 'rules/tag',
    handler: async (uid, req) =>
      jsonResponse(200, await postTagRulePayload(uid, req.rawBody)),
  },
];

async function matchAuthenticatedRoute(
  method: string,
  path: string,
  uid: string,
  req: InternalRequest,
): Promise<{ response: InternalResponse; routeLog: string } | null> {
  if (method === 'GET') {
    for (const r of authenticatedGetRoutes) {
      if (matchesApiTail(path, r.tail)) {
        const response = await r.handler(uid, req);
        return { response, routeLog: r.routeLog };
      }
    }
  }
  if (method === 'POST') {
    for (const r of authenticatedPostRoutes) {
      if (matchesApiTail(path, r.tail)) {
        const response = await r.handler(uid, req);
        return { response, routeLog: r.routeLog };
      }
    }
  }
  return null;
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

      const matched = await matchAuthenticatedRoute(method, path, uid, req);
      if (matched) {
        log.info('dispatch.response', {
          route: matched.routeLog,
          statusCode: matched.response.statusCode,
        });
        return matched.response;
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
