import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { getFinanceRepository } from '@housef4/db';

function jsonResponse(
  statusCode: number,
  body: object,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Resolves Cognito subject (`sub`) from API Gateway request context.
 * Supports REST API (Cognito authorizer) and HTTP API (JWT authorizer).
 */
function getAuthenticatedUserId(event: APIGatewayEvent): string | undefined {
  const authorizer = event.requestContext?.authorizer as
    | { claims?: { sub?: string }; jwt?: { claims?: { sub?: string } } }
    | undefined;
  if (!authorizer) return undefined;
  const sub = authorizer.jwt?.claims?.sub ?? authorizer.claims?.sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
}

export const handler = async (
  event: APIGatewayEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  console.log(
    `Request started: ${event.httpMethod} ${event.path} - RequestId: ${context.awsRequestId}`,
  );

  const userId = getAuthenticatedUserId(event);
  if (!userId) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const repo = getFinanceRepository();
  const metrics = await repo.getMetrics(userId);

  return jsonResponse(200, {
    message: 'Hello from Node.js Lambda!',
    metrics_sample: metrics,
  });
};
