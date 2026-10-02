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

export const identityResponseSchema = z.object({
  actor: z.object({
    type: z.literal('partner_deployment'),
    provider: z.string(),
    clientId: z.string(),
  }),
  authority: z.object({ name: z.string() }),
  integration: z.object({ attachedAt: z.string() }),
});

export type Identity = z.infer<typeof identityResponseSchema>;

/** `user.id` is the partner user reference /me was called as, not a VITA
 *  identifier. `userRoles` is read live on every call, unlike a delegated
 *  token's own role claim. */
export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), userRoles: z.array(z.string()) }),
  authority: z.object({ name: z.string() }),
});

export type Me = z.infer<typeof meResponseSchema>;

/** What VITA needs to create a plan. Nothing here is a VITA identifier: the
 *  references are all your own, and VITA never returns one of its own. */
export interface CreatePlanRequest {
  /** Your handle for this plan, unique within your attachment. Opaque to
   *  VITA, which never parses it -- iDox composes it as
   *  `<CASE_ID>_<FIRST_PLAN_ID>`. Sending it twice is refused rather than
   *  duplicated, which is what makes a retry after a timeout safe. */
  planId: string;
  /** The case reference a coordinator reads on the plan in VITA. */
  caseIdentifier: string;
  /** `YYYY-MM-DD`, or any ISO date string -- only the date part is kept. */
  dueOn: string;
  /** The assignee's user reference, as mapped in your attachment. Not a VITA
   *  identifier. */
  assigneeId: string;
}

export const createdPlanResponseSchema = z.object({
  plan: z.object({
    id: z.string(),
    caseIdentifier: z.string(),
    dueOn: z.string(),
    assignee: z.object({ id: z.string() }),
  }),
});

export type CreatedPlan = z.infer<typeof createdPlanResponseSchema>['plan'];

/** What VITA needs to grant an upload. `contentLength` must match the bytes
 *  sent to the returned URL exactly -- it is part of what gets signed. */
export interface RequestDocumentUploadRequest {
  filename: string;
  contentType: string;
  contentLength: number;
}

export const requestDocumentUploadResponseSchema = z.object({
  upload: z.object({
    uploadId: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
});

export type RequestedDocumentUpload = z.infer<
  typeof requestDocumentUploadResponseSchema
>['upload'];

/** PENDING, PROCESSING and EXPIRED are all still yours to poll; COMPLETED
 *  and FAILED are terminal, same as VITA's own DocumentUploadStatus. */
export const documentUploadStatusResponseSchema = z.object({
  upload: z.object({
    uploadId: z.string(),
    status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED']),
    error: z.object({ code: z.string(), description: z.string() }).nullable(),
  }),
});

export type DocumentUploadStatusResult = z.infer<
  typeof documentUploadStatusResponseSchema
>['upload'];
