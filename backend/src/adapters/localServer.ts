import * as http from 'node:http';
import { randomUUID } from 'node:crypto';

import flow from 'lodash/flow';

import { resolveLocalUserId } from '../auth/resolveLocalUserId';
import type { AppConfig } from '../config';
import { loadConfig } from '../config';
import { dispatch } from '../dispatch';
import { createLogger } from '../logger';
import { getLog, runWithRequestLogAsync } from '../requestLogContext';
import type { InternalRequest, InternalResponse } from '../types';
import {
  bodyFieldsFromBuffer,
  methodMayHaveBody,
  normalizeHeaderValues,
  queryFromUrl,
  serializeResponsePayload,
} from './httpCommon';

const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

type LocalRequestLine = {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
};

const parseLocalRequestLine = flow(
  (req: http.IncomingMessage) => ({
    method: req.method ?? 'GET',
    url: new URL(req.url ?? '/', 'http://127.0.0.1'),
  }),
  ({ method, url }) => ({
    method,
    path: url.pathname,
    query: queryFromUrl(url),
  }),
);

function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (c: Buffer) => {
      totalBytes += c.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function toLocalInternalRequest(
  req: http.IncomingMessage,
  cfg: AppConfig,
  line: LocalRequestLine,
): Promise<InternalRequest> {
  let rawBody = '';
  let bodyBuffer: Buffer | undefined;
  if (methodMayHaveBody(line.method)) {
    const fields = bodyFieldsFromBuffer(await readBodyBuffer(req));
    rawBody = fields.rawBody;
    bodyBuffer = fields.bodyBuffer;
  }

  return {
    method: line.method,
    path: line.path,
    query: line.query,
    headers: normalizeHeaderValues(req.headers),
    rawBody,
    bodyBuffer,
    userId: resolveLocalUserId(cfg),
  };
}

function writeNodeResponse(res: http.ServerResponse, out: InternalResponse): void {
  res.writeHead(out.statusCode, { ...out.headers });
  res.end(serializeResponsePayload(out.body));
}

function respondUnhandledError(res: http.ServerResponse, err: unknown): void {
  createLogger({ phase: 'localServer' }).error('http.request.unhandled', {
    err: err instanceof Error ? err.message : String(err),
    errName: err instanceof Error ? err.name : undefined,
    stack: err instanceof Error ? err.stack : undefined,
  });
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(500, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Internal Server Error' }));
}

async function handleLocalRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: AppConfig,
): Promise<void> {
  await runWithRequestLogAsync(randomUUID(), async () => {
    const log = getLog();
    const line = parseLocalRequestLine(req);
    log.info('http.request', { method: line.method, path: line.path });

    const internal = await toLocalInternalRequest(req, cfg, line);
    const out = await dispatch(internal);

    log.info('http.response', {
      statusCode: out.statusCode,
      method: line.method,
      path: line.path,
    });
    writeNodeResponse(res, out);
  });
}

function listenAsync(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve());
    server.on('error', reject);
  });
}

function logBoot(cfg: AppConfig): void {
  createLogger({ phase: 'localServer.boot' }).info('localServer.listen', {
    appEnv: cfg.appEnv,
    port: PORT,
    dynamodbTableName: cfg.dynamodbTableName ?? null,
    dynamodbEndpoint: cfg.dynamodbEndpoint ?? null,
    awsRegion: cfg.awsRegion ?? process.env.AWS_REGION ?? 'eu-west-2',
  });
}

export async function startLocalServer(): Promise<http.Server> {
  const cfg = loadConfig();
  logBoot(cfg);

  const server = http.createServer((req, res) => {
    handleLocalRequest(req, res, cfg).catch((err) => respondUnhandledError(res, err));
  });

  await listenAsync(server, PORT);

  createLogger({ phase: 'localServer.boot' }).info('localServer.ready', {
    url: `http://localhost:${PORT}/api/health`,
  });
  return server;
}

async function main(): Promise<void> {
  await startLocalServer();
}

if (require.main === module) {
  main().catch((err) => {
    createLogger({ phase: 'localServer' }).error('localServer.fatal', {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exitCode = 1;
  });
}
