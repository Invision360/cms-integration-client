import { delegatedTokenResponseSchema, type DelegatedToken } from '../types';
import { readBody, send, type RouteContext } from './context';

/** Must match expected values from VITA */
const TOKEN_EXCHANGE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:token-exchange';
const PARTNER_USER_REFERENCE_TOKEN_TYPE =
  'urn:invision360:params:oauth:token-type:partner-user-reference';

const LABEL = 'Delegated token exchange';

const exchange = (
  ctx: RouteContext,
  actorToken: string,
  partnerUserRef: string,
) =>
  send(
    ctx,
    '/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${actorToken}`,
      },
      body: new URLSearchParams({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        subject_token: partnerUserRef,
        subject_token_type: PARTNER_USER_REFERENCE_TOKEN_TYPE,
      }),
    },
    LABEL,
  );

export const getDelegatedToken = async (
  ctx: RouteContext,
  partnerUserRef: string,
): Promise<DelegatedToken> => {
  let response = await exchange(
    ctx,
    await ctx.actorTokens.get(),
    partnerUserRef,
  );
  if (response.status === 401) {
    ctx.actorTokens.invalidate();
    response = await exchange(ctx, await ctx.actorTokens.get(), partnerUserRef);
  }
  return readBody(
    response,
    delegatedTokenResponseSchema,
    LABEL,
    'Delegated token exchange response was missing required fields.',
  );
};

/** Mints the delegated token for `partnerUserRef` and calls `request` with
 *  it, retrying once with a fresh delegated token on a 401 -- shared by
 *  every route that acts as a delegate rather than as the actor itself. */
export const asDelegate = async (
  ctx: RouteContext,
  partnerUserRef: string,
  request: (delegatedToken: string) => Promise<Response>,
): Promise<Response> => {
  const delegated = await getDelegatedToken(ctx, partnerUserRef);
  const response = await request(delegated.accessToken);
  if (response.status !== 401) return response;

  ctx.actorTokens.invalidate();
  const refreshed = await getDelegatedToken(ctx, partnerUserRef);
  return request(refreshed.accessToken);
};
