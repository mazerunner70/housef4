import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { getFinanceRepository } from '@housef4/db';

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? 'default';

export const handler = async (
  event: APIGatewayEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  console.log(
    `Request started: ${event.httpMethod} ${event.path} - RequestId: ${context.awsRequestId}`,
  );

  const repo = getFinanceRepository();
  const metrics = await repo.getMetrics(DEFAULT_USER_ID);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from Node.js Lambda!',
      metrics_sample: metrics,
    }),
  };
};
