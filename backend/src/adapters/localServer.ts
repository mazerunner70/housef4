import * as http from 'node:http';
import { loadConfig } from '../config';
import { dispatch } from '../dispatch';
import type { InternalRequest } from '../types';

const PORT = Number(process.env.PORT) || 3000;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      chunks.push(c);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
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
  console.log(`APP_ENV: ${cfg.appEnv} — listening on port ${PORT}`);

  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';
      let rawBody = '';
      if (method !== 'GET' && method !== 'HEAD') {
        rawBody = await readBody(req);
      }
      const internal: InternalRequest = {
        method,
        path: url,
        headers: incomingHeaders(req),
        rawBody,
      };
      const out = await dispatch(internal);
      const headerPairs: Record<string, string | number> = { ...out.headers };
      res.writeHead(out.statusCode, headerPairs);
      res.end(JSON.stringify(out.body));
    } catch (err) {
      console.error(err);
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

  console.log(`Local API: http://localhost:${PORT}/api/health`);
  return server;
}

async function main(): Promise<void> {
  await startLocalServer();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
