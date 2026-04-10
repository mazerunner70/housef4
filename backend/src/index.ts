import type { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { lambdaHandler } from './adapters/lambda';

export const handler = async (
  event: APIGatewayEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => lambdaHandler(event, context);
