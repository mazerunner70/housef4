import { getAccountsPayload } from './handlers/accounts';
import { getBackupExportPayload } from './handlers/backupExport';
import { postBackupRestoreAbortPayload, postBackupRestorePayload } from './handlers/backupRestore';
import { getHealthPayload } from './handlers/health';
import { postImportPayload } from './handlers/imports';
import { getMePayload } from './handlers/me';
import { getMetricsPayload } from './handlers/metrics';
import { getReviewQueuePayload } from './handlers/reviewQueue';
import { patchTransactionFileCurrencyPayload } from './handlers/patchTransactionFileCurrency';
import { getTransactionFilesPayload } from './handlers/transactionFiles';
import { postTagRulePayload } from './handlers/tagRule';
import { getTransactionsCsvExport } from './handlers/transactionsCsvExport';
import { getTransactionsPayload } from './handlers/transactions';
import { HttpError } from './httpError';
import { normalizeApiPath } from './pathNormalize';
import { getLog } from './requestLogContext';
import type { InternalRequest, InternalResponse } from './types';

function pathnameSegments(normalizedPath: string): string[] {
  const pathname = normalizedPath.split('?')[0] ?? '';
  return pathname.split('/').filter((s) => s.length > 0);
}

/** Path segments after `/api/` for the normalized path (e.g. `['rules','tag']`). */
function apiRouteTail(normalizedPath: string): string[] {
  const segments = pathnameSegments(normalizedPath);
  const apiIdx = segments.indexOf('api');
  return apiIdx < 0 ? [] : segments.slice(apiIdx + 1);
}

const isHealthPath = (normalizedPath: string): boolean => {
  const tail = apiRouteTail(normalizedPath);
  return tail.length === 1 && tail[0] === 'health';
};

const tailKey = (tail: string[]): string => tail.join('/');

/** `/api/transaction-files/<importFileId>` — returns id or null. */
function transactionFileIdFromTail(tail: string[]): string | null {
  if (tail.length !== 2 || tail[0] !== 'transaction-files') return null;
  const id = tail[1]?.trim();
  return id || null;
}

/** True for `/api/...` routes that are not public (health). Matches API Gateway JWT on `ANY /api/{proxy+}`. */
const requiresAuthenticatedApiUser = (normalizedPath: string): boolean =>
  (normalizedPath.split('?')[0] ?? '').startsWith('/api/') && !isHealthPath(normalizedPath);

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

const jsonOk = (body: unknown, extraHeaders?: Record<string, string>) =>
  jsonResponse(200, body, extraHeaders);

function csvAttachmentResponse(statusCode: number, csvBody: string, filename: string): InternalResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: csvBody,
  };
}

type RouteHandler = (uid: string, req: InternalRequest) => Promise<InternalResponse>;

type MatchedRoute = {
  routeLog: string;
  handler: RouteHandler;
};

type TailRouteSpec = MatchedRoute & {
  method: string;
  tail: string[];
};

type CustomRouteSpec = MatchedRoute & {
  method: string;
  match: (tail: string[]) => boolean;
};

type RouteSpec = TailRouteSpec | CustomRouteSpec;

const route = (
  method: string,
  routeLog: string,
  tail: string[],
  handler: RouteHandler,
): TailRouteSpec => ({ method, routeLog, tail, handler });

const customRoute = (
  method: string,
  routeLog: string,
  match: (tail: string[]) => boolean,
  handler: RouteHandler,
): CustomRouteSpec => ({ method, routeLog, match, handler });

function compileRoutes(specs: RouteSpec[]): {
  byMethodAndTail: Map<string, Map<string, MatchedRoute>>;
  customByMethod: Map<string, CustomRouteSpec[]>;
} {
  const byMethodAndTail = new Map<string, Map<string, MatchedRoute>>();
  const customByMethod = new Map<string, CustomRouteSpec[]>();

  for (const spec of specs) {
    if ('tail' in spec) {
      let methodRoutes = byMethodAndTail.get(spec.method);
      if (!methodRoutes) {
        methodRoutes = new Map();
        byMethodAndTail.set(spec.method, methodRoutes);
      }
      methodRoutes.set(tailKey(spec.tail), spec);
      continue;
    }
    const customRoutes = customByMethod.get(spec.method) ?? [];
    customRoutes.push(spec);
    customByMethod.set(spec.method, customRoutes);
  }

  return { byMethodAndTail, customByMethod };
}

const syncPayload = (fn: (uid: string) => unknown): RouteHandler =>
  async (uid) => jsonOk(fn(uid));

const asyncPayloadUid = (fn: (uid: string) => Promise<unknown>): RouteHandler =>
  async (uid) => jsonOk(await fn(uid));

const asyncPayloadReq = (
  fn: (uid: string, req: InternalRequest) => Promise<unknown>,
): RouteHandler => async (uid, req) => jsonOk(await fn(uid, req));

const queryParam = (req: InternalRequest, name: string): string | undefined =>
  req.query?.[name]?.trim() || undefined;

const authenticatedRouteSpecs: RouteSpec[] = [
  route('GET', 'me', ['me'], syncPayload(getMePayload)),
  route('GET', 'metrics', ['metrics'], asyncPayloadUid(getMetricsPayload)),
  route('GET', 'accounts', ['accounts'], asyncPayloadUid(getAccountsPayload)),
  route('GET', 'transactions/export', ['transactions', 'export'], async (uid, req) => {
    const csv = await getTransactionsCsvExport(uid, req);
    return csvAttachmentResponse(200, csv, `housef4-transactions-${Date.now()}.csv`);
  }),
  route('GET', 'transactions', ['transactions'], async (uid, req) =>
    jsonOk(
      await getTransactionsPayload(uid, {
        transactionFileId: queryParam(req, 'transactionFileId'),
        clusterId: queryParam(req, 'clusterId'),
      }),
    ),
  ),
  route('GET', 'review-queue', ['review-queue'], asyncPayloadUid(getReviewQueuePayload)),
  route('GET', 'transaction-files', ['transaction-files'], asyncPayloadUid(getTransactionFilesPayload)),
  route('GET', 'backup/export', ['backup', 'export'], async (uid) => {
    const body = await getBackupExportPayload(uid);
    return jsonOk(body, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="housef4-backup-${body.exported_at}.json"`,
    });
  }),
  route('POST', 'imports', ['imports'], asyncPayloadReq(postImportPayload)),
  route('POST', 'rules/tag', ['rules', 'tag'], async (uid, req) =>
    jsonOk(await postTagRulePayload(uid, req.rawBody)),
  ),
  route('POST', 'backup/restore', ['backup', 'restore'], asyncPayloadReq(postBackupRestorePayload)),
  route('POST', 'backup/restore/abort', ['backup', 'restore', 'abort'], asyncPayloadUid(postBackupRestoreAbortPayload)),
  customRoute(
    'PATCH',
    'transaction-files/currency',
    (tail) => transactionFileIdFromTail(tail) !== null,
    async (uid, req) => {
      const importFileId = transactionFileIdFromTail(apiRouteTail(normalizeApiPath(req.path)));
      if (!importFileId) return jsonResponse(404, { error: 'Not Found' });
      return jsonOk(await patchTransactionFileCurrencyPayload(uid, importFileId, req.rawBody));
    },
  ),
];

const { byMethodAndTail, customByMethod } = compileRoutes(authenticatedRouteSpecs);

async function matchAuthenticatedRoute(
  method: string,
  path: string,
  uid: string,
  req: InternalRequest,
): Promise<{ response: InternalResponse; routeLog: string } | null> {
  const tail = apiRouteTail(path);
  const tailRoute = byMethodAndTail.get(method)?.get(tailKey(tail));
  if (tailRoute) {
    return { response: await tailRoute.handler(uid, req), routeLog: tailRoute.routeLog };
  }

  for (const customRouteSpec of customByMethod.get(method) ?? []) {
    if (customRouteSpec.match(tail)) {
      return {
        response: await customRouteSpec.handler(uid, req),
        routeLog: customRouteSpec.routeLog,
      };
    }
  }

  return null;
}

function logAndReturn(
  log: ReturnType<typeof getLog>,
  route: string,
  response: InternalResponse,
): InternalResponse {
  log.info('dispatch.response', { route, statusCode: response.statusCode });
  return response;
}

function handleDispatchError(err: unknown): InternalResponse {
  const log = getLog();
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
      return logAndReturn(log, 'health', jsonOk(await getHealthPayload()));
    }

    if (requiresAuthenticatedApiUser(path)) {
      const uid = req.userId;
      if (!uid) {
        log.info('dispatch.unauthorized', { method, path });
        return jsonResponse(401, { error: 'Unauthorized' });
      }

      const matched = await matchAuthenticatedRoute(method, path, uid, req);
      if (matched) {
        return logAndReturn(log, matched.routeLog, matched.response);
      }

      log.info('dispatch.notFound', { method, path, authenticated: true });
      return jsonResponse(404, { error: 'Not Found' });
    }

    log.info('dispatch.notFound', { method, path, authenticated: false });
    return jsonResponse(404, { error: 'Not Found' });
  } catch (err) {
    return handleDispatchError(err);
  }
}
