#!/usr/bin/env node
/**
 * Replay cleaning → clustering → categorisation on a user's DynamoDB ledger.
 *
 * Usage (from repo root, with local DynamoDB running on :8000):
 *
 *   DYNAMODB_ENDPOINT=http://localhost:8000 DYNAMODB_TABLE_NAME=housef4-local-table \
 *     pnpm --filter @housef4/backend run replay:clustering -- \
 *       --user-id local-dev \
 *       --json ml-training/generated/replay_clustering.json
 *
 * Fast iteration (hash embeddings, same as unit tests):
 *
 *   HOUSEF4_IMPORT_EMBEDDINGS=hash pnpm --filter @housef4/backend run replay:clustering -- --user-id local-dev
 *
 * Production-parity embeddings (loads Xenova MiniLM — slower first run):
 *
 *   pnpm --filter @housef4/backend run replay:clustering -- --user-id local-dev --embeddings model
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DynamoFinanceRepository } from '@housef4/db';

import {
  replayClusteringForUser,
  serializeReplayResult,
} from '../services/import/clustering/replayClustering';

type CliArgs = Readonly<{
  userId: string;
  jsonOut?: string;
  txnIds: string[];
  merchantSubstring?: string;
  diffsOnly: boolean;
  embeddings: 'env' | 'hash' | 'model';
  help: boolean;
}>;

function printHelp(): void {
  process.stdout.write(`replay-clustering — re-run import clustering on a DynamoDB ledger

Options:
  --user-id <id>           Required. User partition (e.g. local-dev).
  --json <path>            Write JSON output to file (also prints summary to stderr).
  --txn-id <id>            Filter output to transaction id(s); repeat allowed.
                           Clustering always uses the full corpus.
  --merchant-substr <text> Filter output rows whose raw/cleaned merchant contains text.
  --diffs-only             Only rows where replay differs from stored fields.
  --embeddings hash|model  hash forces HOUSEF4_IMPORT_EMBEDDINGS=hash for this run.
                           model uses MiniLM when available. Default: respect env.
  --help                   Show this message.

Environment:
  DYNAMODB_TABLE_NAME      Required.
  DYNAMODB_ENDPOINT        Optional (e.g. http://localhost:8000 for DynamoDB Local).
  HOUSEF4_IMPORT_EMBEDDINGS  hash | (unset for model)
`);
}

function parseArgs(argv: string[]): CliArgs {
  let userId = process.env.ML_USER_ID?.trim() || process.env.DEV_AUTH_USER_ID?.trim() || '';
  let jsonOut: string | undefined;
  const txnIds: string[] = [];
  let merchantSubstring: string | undefined;
  let diffsOnly = false;
  let embeddings: CliArgs['embeddings'] = 'env';
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--user-id':
        userId = argv[++i]?.trim() ?? '';
        break;
      case '--json':
        jsonOut = argv[++i];
        break;
      case '--txn-id':
        txnIds.push(argv[++i] ?? '');
        break;
      case '--merchant-substr':
        merchantSubstring = argv[++i];
        break;
      case '--diffs-only':
        diffsOnly = true;
        break;
      case '--embeddings': {
        const mode = argv[++i];
        if (mode !== 'hash' && mode !== 'model') {
          throw new Error('--embeddings must be hash or model');
        }
        embeddings = mode;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { userId, jsonOut, txnIds, merchantSubstring, diffsOnly, embeddings, help };
}

function applyEmbeddingsEnv(mode: CliArgs['embeddings']): void {
  if (mode === 'hash') {
    process.env.HOUSEF4_IMPORT_EMBEDDINGS = 'hash';
  } else if (mode === 'model') {
    delete process.env.HOUSEF4_IMPORT_EMBEDDINGS;
  }
}

function summarize(result: Awaited<ReturnType<typeof replayClusteringForUser>>): void {
  const { meta, rows } = result;
  const diffCount = rows.filter((r) =>
    Object.values(r.differs).some(Boolean),
  ).length;

  process.stderr.write(
    [
      `user=${meta.user_id} corpus=${meta.corpus_transaction_count} clusterable=${meta.clusterable_transaction_count}`,
      `output=${meta.output_row_count} with_diffs=${diffCount} embedder_model=${meta.embedder_uses_model}`,
      meta.note,
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.userId) {
    throw new Error('--user-id is required (or set ML_USER_ID / DEV_AUTH_USER_ID)');
  }
  if (!process.env.DYNAMODB_TABLE_NAME?.trim()) {
    throw new Error('DYNAMODB_TABLE_NAME must be set');
  }

  applyEmbeddingsEnv(args.embeddings);

  const repo = new DynamoFinanceRepository();
  const result = await replayClusteringForUser({
    userId: args.userId,
    repo,
    filters: {
      txnIds: args.txnIds.length > 0 ? new Set(args.txnIds) : undefined,
      merchantSubstring: args.merchantSubstring,
      diffsOnly: args.diffsOnly,
    },
  });

  const json = serializeReplayResult(result);
  summarize(result);

  if (args.jsonOut) {
    const outPath = resolve(args.jsonOut);
    writeFileSync(outPath, json, 'utf8');
    process.stderr.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`replay-clustering: ${message}\n`);
  process.exit(1);
});
