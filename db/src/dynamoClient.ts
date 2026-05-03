import type { DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { dbLog } from './structuredLog';

let cached: DynamoDBDocumentClient | undefined;
let cacheKey: string | undefined;

function clientConfig(): { key: string; config: DynamoDBClientConfig } {
  const region = process.env.AWS_REGION ?? 'eu-west-2';
  const endpoint = process.env.DYNAMODB_ENDPOINT?.trim();
  if (endpoint) {
    const key = `${region}|${endpoint}`;
    return {
      key,
      config: {
        region,
        endpoint,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
        },
      },
    };
  }
  return {
    key: `${region}|default-provider`,
    config: { region },
  };
}

export function getDocumentClient(): DynamoDBDocumentClient {
  const { key, config } = clientConfig();
  if (!cached || cacheKey !== key) {
    dbLog('info', 'dynamoClient.documentClient.created', {
      region: config.region,
      customEndpoint: Boolean(process.env.DYNAMODB_ENDPOINT?.trim()),
      cacheKey: key,
    });
    const client = new DynamoDBClient(config);
    cached = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    cacheKey = key;
  }
  return cached;
}

export function requireTableName(): string {
  const name = process.env.DYNAMODB_TABLE_NAME;
  if (!name) {
    throw new Error('DYNAMODB_TABLE_NAME must be set for DynamoDB access');
  }
  return name;
}

/** Restore-staging replica of the primary key design (`lambda_api.tf` → `DYNAMODB_RESTORE_STAGING_TABLE_NAME`). */
export function requireRestoreStagingTableName(): string {
  const name = process.env.DYNAMODB_RESTORE_STAGING_TABLE_NAME?.trim();
  if (!name) {
    throw new Error(
      'DYNAMODB_RESTORE_STAGING_TABLE_NAME must be set when using the restore staging table',
    );
  }
  return name;
}
