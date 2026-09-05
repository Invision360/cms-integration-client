import { PartnerApiError } from './errors';
import { actorTokenResponseSchema, type PartnerApiClientConfig } from './types';
import { basicAuthHeader } from './utils/http';

/** A call this close to `expires_in` is treated as already expired. */
const EXPIRY_BUFFER_SECONDS = 30;

interface MintedActorToken {
  token: string;
  expiresAt: number;
}

type ActorTokenCacheConfig = Pick<
  PartnerApiClientConfig,
  'tokenEndpoint' | 'clientId' | 'clientSecret'
>;

/** Mints, caches and refreshes the actor token a `PartnerApiClient` uses to
 *  authenticate its own requests. */
export class ActorTokenCache {
  private held: MintedActorToken | null = null;
  private inFlight: Promise<MintedActorToken> | null = null;

  constructor(
    private readonly config: ActorTokenCacheConfig,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async get(): Promise<string> {
    if (this.held && this.held.expiresAt > Date.now()) {
      return this.held.token;
    }
    const token = await this.refresh();
    return token.token;
  }

  invalidate(): void {
    this.held = null;
  }

  /** Shared between concurrent callers so a burst mints one token, not one
   *  per caller. A failed refresh leaves `held` untouched, so retrying
   *  starts fresh. */
  private refresh(): Promise<MintedActorToken> {
    if (!this.inFlight) {
      this.inFlight = this.mint()
        .then(token => {
          this.held = token;
          return token;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  /** No `scope` parameter - omitted for now because makes change management easier between partners and Invision */
  private async mint(): Promise<MintedActorToken> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader(
            this.config.clientId,
            this.config.clientSecret,
          ),
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      });
    } catch {
      throw new PartnerApiError('Actor token request failed.', 'network');
    }

    if (!response.ok) {
      throw new PartnerApiError(
        `Actor token request was rejected with status ${response.status}.`,
        'http',
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PartnerApiError(
        'Actor token response was not valid JSON.',
        'malformed-response',
      );
    }

    const parsed = actorTokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PartnerApiError(
        'Actor token response was missing required fields.',
        'malformed-response',
      );
    }

    return {
      token: parsed.data.accessToken,
      expiresAt:
        Date.now() + (parsed.data.expiresIn - EXPIRY_BUFFER_SECONDS) * 1000,
    };
  }
}
