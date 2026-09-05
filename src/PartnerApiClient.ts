import { ActorTokenCache } from './ActorTokenCache';
import { PartnerApiError } from './errors';
import {
  delegatedTokenResponseSchema,
  identityResponseSchema,
  type DelegatedToken,
  type Identity,
  type PartnerApiClientConfig,
} from './types';
import { errorFromResponse, parseJsonBody } from './utils/http';

/** Must match expected values from VITA */
const TOKEN_EXCHANGE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:token-exchange';
const PARTNER_USER_REFERENCE_TOKEN_TYPE =
  'urn:invision360:params:oauth:token-type:partner-user-reference';

export class PartnerApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly actorTokens: ActorTokenCache;

  constructor(private readonly config: PartnerApiClientConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.actorTokens = new ActorTokenCache(config, this.fetchImpl);
  }

  /** Your deployment's own credential, minted and cached in memory. Refreshed
   *  automatically before expiry, with one in-flight request shared across
   *  concurrent callers. */
  getActorToken(): Promise<string> {
    return this.actorTokens.get();
  }

  /** Exchanges `userId` for a short-lived token scoped to that user, valid
   *  for 15 minutes and not cached by the client. Retries once with a fresh
   *  actor token on a 401. Every other failure is surfaced as-is -- retrying
   *  those would not change the outcome.
   *
   *  @deprecated Will become an internal implementation detail once user
   *  actions (e.g. `createPlan`) are added -- those will exchange and call
   *  on your behalf. Currently used for testing. */
  async getDelegatedToken(userId: string): Promise<DelegatedToken> {
    const actorToken = await this.getActorToken();
    let response = await this.exchange(actorToken, userId);
    if (response.status === 401) {
      this.actorTokens.invalidate();
      response = await this.exchange(await this.getActorToken(), userId);
    }
    if (!response.ok) {
      throw await errorFromResponse(response, 'Delegated token exchange');
    }

    const body = await parseJsonBody(response, 'Delegated token exchange');
    const parsed = delegatedTokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PartnerApiError(
        'Delegated token exchange response was missing required fields.',
        'malformed-response',
      );
    }
    return parsed.data;
  }

  /** Resolves an actor or delegated token to the authority (and, for a
   *  delegated token, the subject) it names.
   *
   *  @deprecated Will become an internal implementation detail similar to
   *  `getDelegatedToken` once user actions (e.g. `createPlan`) are added. */
  async getIdentity(accessToken: string): Promise<Identity> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.apiUrl}/identity`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new PartnerApiError('Identity request failed.', 'network');
    }
    if (!response.ok) {
      throw await errorFromResponse(response, 'Identity request');
    }

    const body = await parseJsonBody(response, 'Identity request');
    const parsed = identityResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PartnerApiError(
        'Identity response was missing required fields.',
        'malformed-response',
      );
    }
    return parsed.data;
  }

  private async exchange(
    actorToken: string,
    userId: string,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.config.apiUrl}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${actorToken}`,
        },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          subject_token: userId,
          subject_token_type: PARTNER_USER_REFERENCE_TOKEN_TYPE,
        }),
      });
    } catch {
      throw new PartnerApiError('Delegated token exchange failed.', 'network');
    }
  }
}
