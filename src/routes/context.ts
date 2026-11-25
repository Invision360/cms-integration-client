import type { z } from 'zod';
import type { ActorTokenCache } from '../ActorTokenCache';
import { PartnerApiError } from '../errors';
import { errorFromResponse, parseJsonBody } from '../utils/http';

/** What every route needs from the client that owns it. */
export interface RouteContext {
  apiUrl: string;
  fetch: typeof fetch;
  actorTokens: ActorTokenCache;
}

/** One VITA request. `label` names the call in every error it throws, so a
 *  failure reads the same whichever step it came from. */
export const send = async (
  ctx: RouteContext,
  path: string,
  init: RequestInit,
  label: string,
): Promise<Response> => {
  try {
    return await ctx.fetch(`${ctx.apiUrl}${path}`, init);
  } catch {
    throw new PartnerApiError(`${label} failed.`, 'network');
  }
};

/** Turns a non-2xx into its PartnerApiError and validates a 2xx body. */
export const readBody = async <S extends z.ZodTypeAny>(
  response: Response,
  schema: S,
  label: string,
  malformed: string,
): Promise<z.output<S>> => {
  if (!response.ok) throw await errorFromResponse(response, label);

  const parsed = schema.safeParse(await parseJsonBody(response, label));
  if (!parsed.success)
    throw new PartnerApiError(malformed, 'malformed-response');
  return parsed.data;
};

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
