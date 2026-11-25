import { ActorTokenCache } from './ActorTokenCache';
import * as routes from './routes';
import type { RouteContext } from './routes';
import type {
  CreatedPlan,
  CreatePlanRequest,
  DelegatedToken,
  DocumentUploadStatusResult,
  Identity,
  Me,
  PartnerApiClientConfig,
  PlanContent,
  PlanStatusResult,
  RequestDocumentUploadRequest,
  RequestedDocumentUpload,
} from './types';

/** The public surface. Each method is one route in `routes/`, which holds
 *  the request, retry and parsing; this class only owns the shared context. */
export class PartnerApiClient {
  private readonly ctx: RouteContext;

  constructor(config: PartnerApiClientConfig) {
    const fetchImpl = config.fetch ?? fetch;
    this.ctx = {
      apiUrl: config.apiUrl,
      fetch: fetchImpl,
      actorTokens: new ActorTokenCache(config, fetchImpl),
    };
  }

  /** Your deployment's own credential, minted and cached in memory. Refreshed
   *  automatically before expiry, with one in-flight request shared across
   *  concurrent callers. */
  getActorToken(): Promise<string> {
    return this.ctx.actorTokens.get();
  }

  /** Exchanges `partnerUserRef` for a short-lived token scoped to that user,
   *  valid for 15 minutes and not cached by the client. Retries once with a
   *  fresh actor token on a 401. Every other failure (400, 403, network,
   *  malformed response) is surfaced as-is -- retrying those would not
   *  change the outcome. */
  getDelegatedToken(partnerUserRef: string): Promise<DelegatedToken> {
    return routes.getDelegatedToken(this.ctx, partnerUserRef);
  }

  getIdentity(accessToken: string): Promise<Identity> {
    return routes.getIdentity(this.ctx, accessToken);
  }

  /** Mints the delegated token for you. Retries once on a 401 with a fresh
   *  delegated token, since one lives 15 minutes. Roles are read live on
   *  every call, unlike a delegated token's own role claim. */
  getMe(partnerUserRef: string): Promise<Me> {
    return routes.getMe(this.ctx, partnerUserRef);
  }

  /** Both tokens are minted here so a caller never handles them. Retries once
   *  on a 401 with a fresh delegated token, since a delegated token lives 15
   *  minutes and may expire between being minted and being used. Only a 401
   *  is retried: it means the request was rejected before any plan was
   *  created, so the retry cannot duplicate one. */
  createPlan(
    partnerUserRef: string,
    plan: CreatePlanRequest,
  ): Promise<CreatedPlan> {
    return routes.createPlan(this.ctx, partnerUserRef, plan);
  }

  /** Both tokens are minted here so a caller never handles them. Retries once
   *  on a 401 with a fresh delegated token, for the same reason createPlan
   *  does -- a 401 means the request was rejected before a grant was issued,
   *  so the retry cannot duplicate one. A 409 is never retried: the caller
   *  decides whether to ask again. */
  requestDocumentUpload(
    partnerUserRef: string,
    planReferenceId: string,
    request: RequestDocumentUploadRequest,
  ): Promise<RequestedDocumentUpload> {
    return routes.requestDocumentUpload(
      this.ctx,
      partnerUserRef,
      planReferenceId,
      request,
    );
  }

  /** Polls the outcome of one upload by the id `requestDocumentUpload`
   *  returned. Retries once on a 401 with a fresh delegated token, for the
   *  same reason every other delegated call does. A 400 (unrecognised or
   *  not yours) is usually not worth retrying: asking again with the same
   *  id gets the same answer. The exception is a freshly issued or
   *  re-issued id, which can read 400 for the first poll or two until the
   *  lookup catches up. The next poll on your usual interval resolves it. */
  getDocumentUploadStatus(
    partnerUserRef: string,
    uploadId: string,
  ): Promise<DocumentUploadStatusResult> {
    return routes.getDocumentUploadStatus(this.ctx, partnerUserRef, uploadId);
  }

  /** Reads the status of a plan you created, by your own `planReferenceId`.
   *  Only `open` accepts documents. `in_progress` and `ready_to_import` can
   *  be imported. Retries once on a 401 with a fresh delegated token, for the
   *  same reason every other delegated call does. A 404 `not_found` means no
   *  plan exists for the reference. A 403 `plan_forbidden` means the plan is
   *  assigned to another user. Neither is worth retrying. Poll on an interval
   *  rather than once, as there is no callback. */
  getPlanStatus(
    partnerUserRef: string,
    planReferenceId: string,
  ): Promise<PlanStatusResult> {
    return routes.getPlanStatus(this.ctx, partnerUserRef, planReferenceId);
  }

  /** Reads the plan as JSON, for import into the CMS. Idempotent: always the
   *  current content, never cached. A 409 `plan_not_ready` means the plan is
   *  not `in_progress` or `ready_to_import`; poll `getPlanStatus` first. At
   *  `in_progress` the plan is a draft and can still change in VITA, so
   *  compare `plan.contentRevision` to know whether your copy is stale.
   *  A 404 `not_found` or 403 `plan_forbidden` is as for `getPlanStatus`.
   *  Nothing here is worth retrying except a `network` failure.
   *
   *  Shape, in brief (`PlanContent` and its part types are exported):
   *
   *  ```
   *  { schemaVersion, plan: { reference, status, contentRevision, ... },
   *    sources: [{ documentName, originalFilename, tags, createdAt }],
   *    details, historyAndViews, specialEducationalNeeds, health,
   *    socialCare, adviceAndInformation }
   *  ```
   *
   *  Values are `string | null` (null only when empty), or rich text as
   *  `{ text, html }` with citations keyed to `sources` by `documentName`.
   *  The full type reference, with an example payload, is "Reading a plan's
   *  content" in this package's README.md. */
  getPlanContent(
    partnerUserRef: string,
    planReferenceId: string,
  ): Promise<PlanContent> {
    return routes.getPlanContent(this.ctx, partnerUserRef, planReferenceId);
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
  uploadDocument(
    partnerUserRef: string,
    planReferenceId: string,
    request: RequestDocumentUploadRequest,
    body: BodyInit,
  ): Promise<RequestedDocumentUpload> {
    return routes.uploadDocument(
      this.ctx,
      partnerUserRef,
      planReferenceId,
      request,
      body,
    );
  }
}
