import * as http from 'node:http';
import { randomUUID } from 'node:crypto';

import { resolveLocalUserId } from '../auth/resolveLocalUserId';
import { loadConfig } from '../config';
import { dispatch } from '../dispatch';
import { createLogger } from '../logger';
import { getLog, runWithRequestLogAsync } from '../requestLogContext';
import type { InternalRequest } from '../types';

const PORT = Number(process.env.PORT) || 3000;

function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      chunks.push(c);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function incomingHeaders(
  req: http.IncomingMessage,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

export async function startLocalServer(): Promise<http.Server> {
  const cfg = loadConfig();
  const boot = createLogger({ phase: 'localServer.boot' });
  boot.info('localServer.listen', {
    appEnv: cfg.appEnv,
    port: PORT,
    dynamodbTableName: cfg.dynamodbTableName ?? null,
    dynamodbEndpoint: cfg.dynamodbEndpoint ?? null,
    awsRegion: cfg.awsRegion ?? process.env.AWS_REGION ?? 'eu-west-2',
  });

  const server = http.createServer(async (req, res) => {
    try {
      await runWithRequestLogAsync(randomUUID(), async () => {
        const log = getLog();
        const url = req.url ?? '/';
        const method = req.method ?? 'GET';
        const pathOnly = url.split('?')[0] ?? url;
        log.info('http.request', { method, path: pathOnly });

        let rawBody = '';
        let bodyBuffer: Buffer | undefined;
        if (method !== 'GET' && method !== 'HEAD') {
          bodyBuffer = await readBodyBuffer(req);
          rawBody = bodyBuffer.length ? bodyBuffer.toString('utf8') : '';
        }
        const internal: InternalRequest = {
          method,
          path: pathOnly,
          headers: incomingHeaders(req),
          rawBody,
          bodyBuffer,
          userId: resolveLocalUserId(cfg),
        };
        const out = await dispatch(internal);
        log.info('http.response', { statusCode: out.statusCode, method, path: pathOnly });
        const headerPairs: Record<string, string | number> = { ...out.headers };
        res.writeHead(out.statusCode, headerPairs);
        res.end(JSON.stringify(out.body));
      });
    } catch (err) {
      createLogger({ phase: 'localServer' }).error('http.request.unhandled', {
        err: err instanceof Error ? err.message : String(err),
        errName: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (res.headersSent) {
        res.end();
      } else {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, () => resolve());
    server.on('error', reject);
  });

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
