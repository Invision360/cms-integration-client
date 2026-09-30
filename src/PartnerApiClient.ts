import { ActorTokenCache } from './ActorTokenCache';
import { PartnerApiError } from './errors';
import {
  createdPlanResponseSchema,
  delegatedTokenResponseSchema,
  documentUploadStatusResponseSchema,
  identityResponseSchema,
  meResponseSchema,
  requestDocumentUploadResponseSchema,
  type CreatedPlan,
  type CreatePlanRequest,
  type DelegatedToken,
  type DocumentUploadStatusResult,
  type Identity,
  type Me,
  type PartnerApiClientConfig,
  type RequestDocumentUploadRequest,
  type RequestedDocumentUpload,
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

  /** Exchanges `partnerUserRef` for a short-lived token scoped to that user,
   *  valid for 15 minutes and not cached by the client. Retries once with a
   *  fresh actor token on a 401. Every other failure (400, 403, network,
   *  malformed response) is surfaced as-is -- retrying those would not
   *  change the outcome. */
  async getDelegatedToken(partnerUserRef: string): Promise<DelegatedToken> {
    const actorToken = await this.getActorToken();
    let response = await this.exchange(actorToken, partnerUserRef);
    if (response.status === 401) {
      this.actorTokens.invalidate();
      response = await this.exchange(
        await this.getActorToken(),
        partnerUserRef,
      );
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

  /** Mints the delegated token for you. Retries once on a 401 with a fresh
   *  delegated token, since one lives 15 minutes. Roles are read live on
   *  every call, unlike a delegated token's own role claim. */
  async getMe(partnerUserRef: string): Promise<Me> {
    const response = await this.callAsDelegate(partnerUserRef, token =>
      this.fetchMe(token),
    );
    if (!response.ok) {
      throw await errorFromResponse(response, 'Me request');
    }

    const body = await parseJsonBody(response, 'Me request');
    const parsed = meResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PartnerApiError(
        'Me response was missing required fields.',
        'malformed-response',
      );
    }
    return parsed.data;
  }

  /** Both tokens are minted here so a caller never handles them. Retries once
   *  on a 401 with a fresh delegated token, since a delegated token lives 15
   *  minutes and may expire between being minted and being used. Only a 401
   *  is retried: it means the request was rejected before any plan was
   *  created, so the retry cannot duplicate one. */
  async createPlan(
    partnerUserRef: string,
    plan: CreatePlanRequest,
  ): Promise<CreatedPlan> {
    const response = await this.callAsDelegate(partnerUserRef, token =>
      this.postPlan(token, plan),
    );
    if (!response.ok) {
      throw await errorFromResponse(response, 'Create plan request');
    }

    const body = await parseJsonBody(response, 'Create plan request');
    const parsed = createdPlanResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PartnerApiError(
        'Create plan response was missing required fields.',
        'malformed-response',
      );
    }
    return parsed.data.plan;
  }

  /** Both tokens are minted here so a caller never handles them. Retries once
   *  on a 401 with a fresh delegated token, for the same reason createPlan
   *  does -- a 401 means the request was rejected before a grant was issued,
   *  so the retry cannot duplicate one. A 409 is never retried: the caller
   *  decides whether to ask again. */
  async requestDocumentUpload(
    partnerUserRef: string,
    planReferenceId: string,
    request: RequestDocumentUploadRequest,
  ): Promise<RequestedDocumentUpload> {
    const response = await this.callAsDelegate(partnerUserRef, token =>
      this.postDocumentUploadRequest(token, planReferenceId, request),
    );
    if (!response.ok) {
      throw await errorFromResponse(response, 'Request document upload');
    }

    const body = await parseJsonBody(response, 'Request document upload');
    const parsed = requestDocumentUploadResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PartnerApiError(
        'Request document upload response was missing required fields.',
        'malformed-response',
      );
    }
    return parsed.data.upload;
  }

  /** Polls the outcome of one upload by the id `requestDocumentUpload`
   *  returned. Retries once on a 401 with a fresh delegated token, for the
   *  same reason every other delegated call does. A 400 (unrecognised or
   *  not yours) is usually not worth retrying: asking again with the same
   *  id gets the same answer. The exception is a freshly issued or
   *  re-issued id, which can read 400 for the first poll or two until the
   *  lookup catches up. The next poll on your usual interval resolves it. */
  async getDocumentUploadStatus(
    partnerUserRef: string,
    uploadId: string,
  ): Promise<DocumentUploadStatusResult> {
    const response = await this.callAsDelegate(partnerUserRef, token =>
      this.fetchDocumentUploadStatus(token, uploadId),
    );
    if (!response.ok) {
      throw await errorFromResponse(response, 'Get document upload status');
    }

    const body = await parseJsonBody(response, 'Get document upload status');
    const parsed = documentUploadStatusResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PartnerApiError(
        'Document upload status response was missing required fields.',
        'malformed-response',
      );
    }
    return parsed.data.upload;
  }

  /** Requests permission to attach a document, then immediately PUTs `body`
   *  to the granted URL with the headers VITA returned -- they already carry
   *  everything the upload needs (content type, grant id), so nothing here
   *  is re-derived from `request`. A caller sends only bytes, never handles
   *  a token or a signed URL.
   *
   *  The PUT itself is a raw S3 request, not a VITA one, so a refusal here
   *  is a plain `PartnerApiError` without a `code` -- there is no VITA error
   *  body to parse. `expiresAt` on the returned grant is worth checking
   *  before a slow upload: after it, the same URL will 403. */
  async uploadDocument(
    partnerUserRef: string,
    planReferenceId: string,
    request: RequestDocumentUploadRequest,
    body: BodyInit,
  ): Promise<RequestedDocumentUpload> {
    const upload = await this.requestDocumentUpload(
      partnerUserRef,
      planReferenceId,
      request,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(upload.url, {
        method: 'PUT',
        headers: upload.headers,
        body,
      });
    } catch {
      throw new PartnerApiError('Document upload failed.', 'network');
    }
    if (!response.ok) {
      throw new PartnerApiError(
        `Document upload was rejected with status ${response.status}.`,
        'http',
        response.status,
      );
    }

    return upload;
  }

  /** Mints the delegated token for `partnerUserRef` and calls `send` with
   *  it, retrying once with a fresh delegated token on a 401 -- shared by
   *  every route that acts as a delegate rather than as the actor itself. */
  private async callAsDelegate(
    partnerUserRef: string,
    send: (delegatedToken: string) => Promise<Response>,
  ): Promise<Response> {
    const delegated = await this.getDelegatedToken(partnerUserRef);
    const response = await send(delegated.accessToken);
    if (response.status !== 401) {
      return response;
    }
    this.actorTokens.invalidate();
    const refreshed = await this.getDelegatedToken(partnerUserRef);
    return send(refreshed.accessToken);
  }

  private async exchange(
    actorToken: string,
    partnerUserRef: string,
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
          subject_token: partnerUserRef,
          subject_token_type: PARTNER_USER_REFERENCE_TOKEN_TYPE,
        }),
      });
    } catch {
      throw new PartnerApiError('Delegated token exchange failed.', 'network');
    }
  }

  private async fetchMe(delegatedToken: string): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.config.apiUrl}/me`, {
        headers: { Authorization: `Bearer ${delegatedToken}` },
      });
    } catch {
      throw new PartnerApiError('Me request failed.', 'network');
    }
  }

  private async postPlan(
    delegatedToken: string,
    plan: CreatePlanRequest,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.config.apiUrl}/plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${delegatedToken}`,
        },
        body: JSON.stringify(plan),
      });
    } catch {
      throw new PartnerApiError('Create plan request failed.', 'network');
    }
  }

  private async postDocumentUploadRequest(
    delegatedToken: string,
    planReferenceId: string,
    request: RequestDocumentUploadRequest,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(
        `${this.config.apiUrl}/plans/${planReferenceId}/documents`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${delegatedToken}`,
          },
          body: JSON.stringify(request),
        },
      );
    } catch {
      throw new PartnerApiError('Request document upload failed.', 'network');
    }
  }

  private async fetchDocumentUploadStatus(
    delegatedToken: string,
    uploadId: string,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.config.apiUrl}/uploads/${uploadId}`, {
        headers: { Authorization: `Bearer ${delegatedToken}` },
      });
    } catch {
      throw new PartnerApiError(
        'Get document upload status failed.',
        'network',
      );
    }
  }
}
