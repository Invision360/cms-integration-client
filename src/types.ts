import { z } from 'zod';

export interface PartnerApiClientConfig {
  /** Already includes the version [`/v1`] stage - don't append it again. */
  apiUrl: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export const actorTokenResponseSchema = z
  .object({
    access_token: z.string(),
    expires_in: z.number(),
  })
  .transform(({ access_token, expires_in }) => ({
    accessToken: access_token,
    expiresIn: expires_in,
  }));

export type ActorTokenResponse = z.infer<typeof actorTokenResponseSchema>;

/** Not cached by this client for now */
export const delegatedTokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number(),
  })
  .transform(({ access_token, token_type, expires_in }) => ({
    accessToken: access_token,
    tokenType: token_type,
    expiresIn: expires_in,
  }));

export type DelegatedToken = z.infer<typeof delegatedTokenResponseSchema>;

/** `subject` is present only for a delegated token */
export const identityResponseSchema = z.object({
  actor: z.object({
    type: z.literal('partner_deployment'),
    provider: z.string(),
    clientId: z.string(),
  }),
  authority: z.object({ name: z.string() }),
  integration: z.object({ attachedAt: z.string() }),
  subject: z.object({ partnerUserRef: z.string() }).optional(),
});

export type Identity = z.infer<typeof identityResponseSchema>;
