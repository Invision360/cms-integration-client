import { meResponseSchema, type Me } from '../types';
import { bearer, readBody, send, type RouteContext } from './context';
import { asDelegate } from './get-delegated-token';

const LABEL = 'Me request';

export const getMe = async (
  ctx: RouteContext,
  partnerUserRef: string,
): Promise<Me> =>
  readBody(
    await asDelegate(ctx, partnerUserRef, token =>
      send(ctx, '/me', { headers: bearer(token) }, LABEL),
    ),
    meResponseSchema,
    LABEL,
    'Me response was missing required fields.',
  );
