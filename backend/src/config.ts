/**
 * Centralized config (12-factor). Both Lambda and the local HTTP server use this module.
 * Avoid reading process.env deep in services — pass values from here or from factories.
 */

export type AppEnv = 'local' | 'staging' | 'production';

export interface AppConfig {
  appEnv: AppEnv;
  awsRegion: string | undefined;
  dynamodbTableName: string | undefined;
  dynamodbEndpoint: string | undefined;
  devAuthUserId: string | undefined;
}

function parseAppEnv(raw: string | undefined): AppEnv {
  if (raw === 'local' || raw === 'staging' || raw === 'production') {
    return raw;
  }
  if (raw === undefined || raw === '') {
    return process.env.AWS_LAMBDA_FUNCTION_NAME ? 'production' : 'local';
  }
  throw new Error(`Invalid APP_ENV: ${raw}`);
}

export function loadConfig(): AppConfig {
  return {
    appEnv: parseAppEnv(process.env.APP_ENV),
    awsRegion: process.env.AWS_REGION,
    dynamodbTableName: process.env.DYNAMODB_TABLE_NAME,
    dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT,
    devAuthUserId: process.env.DEV_AUTH_USER_ID,
  };
}
