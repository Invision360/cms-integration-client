import { identityResponseSchema, type Identity } from '../types';
import { bearer, readBody, send, type RouteContext } from './context';

const LABEL = 'Identity request';

export const getIdentity = async (
  ctx: RouteContext,
  accessToken: string,
): Promise<Identity> =>
  readBody(
    await send(ctx, '/identity', { headers: bearer(accessToken) }, LABEL),
    identityResponseSchema,
    LABEL,
    'Identity response was missing required fields.',
  );
