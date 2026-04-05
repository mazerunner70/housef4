import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { getUserRepository } from '@housef4/db';

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log(`Request started: ${event.httpMethod} ${event.path} - RequestId: ${context.awsRequestId}`);
    
    // Example of using the db layer
    const repo = getUserRepository();
    const result = await repo.getUser('test-id');

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Hello from Node.js Lambda!',
            dbResult: result,
        }),
    };
};
