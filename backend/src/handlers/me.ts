import { getLog } from '../requestLogContext';

export function getMePayload(userId: string): { userId: string } {
  getLog().info('me.payload', { userIdLength: userId.length });
  return { userId };
}
