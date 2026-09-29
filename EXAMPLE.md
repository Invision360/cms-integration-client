# Worked example: contributing case documents to VITA

An end-to-end sketch of the machine-to-machine flow, for partner engineers. Create a
plan for a case and upload its documents.

## Read this first

Everything below -- creating a plan, uploading a document and polling its outcome -- is
built and callable against a VITA sandbox today.

## Vocabulary

| Your term                 | VITA term    | Notes                                              |
| ------------------------- | ------------ | -------------------------------------------------- |
| Customer, Authority       | Organisation | Your per-authority deployment maps to one of these |
| Coordinator               | User         | The person a call is made for                      |
| Case, plus its first Plan | Plan         | The integration covers the first draft EHCP only   |

VITA won't return its own internal identifiers. Every handle you hold is either one
you supplied or one VITA issued specifically for you to hold.

## Before you start

VITA issues four values per authority deployment when your organisation is attached:
`apiUrl`, `tokenEndpoint`, `clientId`, `clientSecret`. Separately, each coordinator who
will submit documents must be mapped: you give VITA your own reference for that person,
VITA links it to a VITA user. An unmapped coordinator is refused, and that is a
provisioning problem to fix rather than an error to retry.

All of this runs server side. `clientSecret` must never reach a browser.

## The flow

```
0. Connect            client credentials      ->  actor token, cached for you (~1 hour)
1. Create the plan    partnerUserRef, plan     ->  plan exists
2. Upload a document   partnerUserRef, file     ->  bytes land in VITA's storage, uploadId
3. Attach              VITA's own background worker attaches the bytes to the plan
4. Poll status         partnerUserRef, uploadId ->  PENDING/PROCESSING/COMPLETED/FAILED/EXPIRED
```

`createPlan` and `uploadDocument` each mint and exchange tokens for you internally, as
the coordinator named by `partnerUserRef` -- you never handle a token directly for the
main flow. Step 2 repeats once per document; step 1 runs once per plan.

---

## Step 0: connect

```ts
import { PartnerApiClient } from '@invision360/vita-ehcp-cms-client';

const vita = new PartnerApiClient({
  apiUrl: process.env.VITA_API_URL!, // already includes /v1
  tokenEndpoint: process.env.VITA_TOKEN_ENDPOINT!,
  clientId: process.env.VITA_CLIENT_ID!,
  clientSecret: process.env.VITA_CLIENT_SECRET!,
});
```

The client mints and caches its own actor token, refreshes it before expiry, and shares
one in-flight refresh across concurrent callers.

Worth doing once at integration time: call `getIdentity` with an actor token and check
the authority you get back is the one this deployment is meant to serve. A misfiled
credential otherwise surfaces much later.

```ts
const identity = await vita.getIdentity(await vita.getActorToken());
// { actor: { type, provider, clientId }, authority: { name }, integration: { attachedAt } }
```

## Step 1: create the plan

```ts
const plan = await vita.createPlan(coordinator.partnerUserRef, {
  planId: `${caseId}_${firstPlanId}`,
  caseIdentifier: caseId,
  dueOn: '2026-11-30',
  assigneeId: coordinator.partnerUserRef, // the reference VITA mapped to this coordinator during onboarding
});
// { id: '<planId>', caseIdentifier, dueOn, assignee: { id } }
```

`planId` is yours and becomes your handle for this plan; nothing on VITA's side parses
it. `caseIdentifier` is what a coordinator reads on the plan in VITA. There is no VITA
plan id to store -- every later call about this plan names it by `planId`.

`assigneeId` is a mapped coordinator, and VITA applies its own rule: a coordinator may
assign a plan to themselves, and only a VITA administrator may assign one to someone
else. The same rule applies when a caseworker does this inside VITA, so it is not an
integration restriction.

**Sending the same `planId` twice is refused, never duplicated.** That makes this call
safe to retry after a network timeout: if you did not see the response, send it again.
Either it creates the plan or a `409 plan_exists` tells you the first attempt had
already landed, and both outcomes are ones you can proceed from.

## Step 2: upload a document

```ts
const upload = await vita.uploadDocument(
  coordinator.partnerUserRef,
  plan.id,
  {
    filename: 'ep-advice.pdf',
    contentType: 'application/pdf',
    contentLength: bytes.length,
  },
  bytes,
);
// { uploadId, url, headers, expiresAt }
```

One call: it requests permission to attach the document, then PUTs `bytes` straight to
VITA's storage with the headers VITA returned -- not through the partner API, which caps
and has stricter payload limits than your own. `contentLength` must match `bytes.length`
exactly; it's part of what VITA signs into the grant, and the grant expires 15 minutes
after issue.

VITA checks what it can before any bytes move, so your UI can tell the coordinator
immediately. Refused at this point: an unaccepted content type, a file over the size
ceiling, a filename already claimed on the plan, or a plan no longer open to
contributions.

Current limits:

| Rule                            | Value                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Content types                   | `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain` |
| Size ceiling                    | 20 MB per file                                                                                                                   |
| Documents per plan              | 20                                                                                                                               |
| Duplicate filenames on one plan | Refused                                                                                                                          |
| Grant lifetime                  | 15 minutes, single use                                                                                                           |

If you'd rather perform the PUT yourself (streaming from disk, a different HTTP
client), call `requestDocumentUpload` directly for just the grant -- `uploadDocument`
wraps it, it isn't the only way to upload.

## Step 3: what happens after

**A successful PUT is not an attached document yet.** The bytes have landed in VITA's
storage; a background worker attaches them to the plan asynchronously, and may still
refuse the attach -- most commonly on the document-count limit, which is enforced again
at this point because a burst of concurrent uploads can each pass the request-time
check.

## Step 4: poll for the outcome

```ts
const status = await vita.getDocumentUploadStatus(
  coordinator.vitaUserRef,
  upload.uploadId,
);
// { uploadId, status, error }
```

| `status`     | Terminal? | Meaning                                                       |
| ------------ | --------- | ------------------------------------------------------------- |
| `PENDING`    | No        | Bytes not yet received, or received but not yet processed     |
| `PROCESSING` | No        | Received; being attached to the plan                          |
| `COMPLETED`  | Yes       | Attached                                                      |
| `FAILED`     | Yes       | Refused; `error.code` names why                               |
| `EXPIRED`    | Yes       | Nothing arrived within the grant window (plus a grace period) |

Poll on an interval rather than once -- there is no callback. `uploadId` is only ever
valid for the upload it was issued for: re-requesting the same filename claim (a retry
after `FAILED` or `EXPIRED`, say) issues a new `uploadId`, and the old one then reads
`invalid_target` rather than the newer upload's status.

---

## Putting it together

```ts
async function submitCaseToVita(caseRecord, coordinator, documents) {
  try {
    await vita.createPlan(coordinator.partnerUserRef, {
      planId: `${caseRecord.id}_${caseRecord.firstPlanId}`,
      caseIdentifier: caseRecord.id,
      dueOn: caseRecord.statutoryDeadline,
      assigneeId: coordinator.partnerUserRef,
    });
  } catch (err) {
    if (!(err instanceof PartnerApiError && err.code === 'plan_exists'))
      throw err;
  }

  for (const document of documents) {
    try {
      await vita.uploadDocument(
        coordinator.partnerUserRef,
        `${caseRecord.id}_${caseRecord.firstPlanId}`,
        {
          filename: document.filename,
          contentType: document.contentType,
          contentLength: document.bytes.length,
        },
        document.bytes,
      );
    } catch (err) {
      if (!(err instanceof PartnerApiError && err.code === 'document_exists'))
        throw err;
    }
  }
}
```

A repeated call for the same case is safe only because this wraps each step: `createPlan`
throws `PartnerApiError` on `409 plan_exists` rather than returning quietly, and a
re-sent document throws on `409 document_exists` the same way. Ignore those two codes and
a retry after a partial failure picks up where it left off; anything else should
propagate.

## Handling errors

Every failure from the client is a `PartnerApiError`, and its message is built only from
the response, never from your request, so it is always safe to log.

```ts
try {
  await vita.createPlan(coordinator.partnerUserRef, plan);
} catch (err) {
  if (err instanceof PartnerApiError) {
    switch (err.kind) {
      case 'network':
        break; // retry
      case 'http':
        break; // err.statusCode, err.code, err.details
      case 'malformed-response':
        break; // a bug, not a retryable failure
    }
  }
}
```

| Call                      | Status | `code`                 | Meaning                                               |
| ------------------------- | ------ | ---------------------- | ----------------------------------------------------- |
| `createPlan`              | `400`  | `invalid_target`       | The assignee isn't mapped. Provisioning, not a retry. |
| `createPlan`              | `400`  | `invalid_request`      | A field is wrong; `err.details` names which.          |
| `createPlan`              | `403`  | `assignment_forbidden` | The acting user may not assign to others.             |
| `createPlan`              | `409`  | `plan_exists`          | This `planId` already has a plan. Safe outcome.       |
| `uploadDocument` request  | `400`  | `invalid_request`      | `filename`, `contentType` or `contentLength` refused. |
| `uploadDocument` request  | `403`  | `upload_forbidden`     | Not an admin, and the plan is assigned to another.    |
| `uploadDocument` request  | `409`  | `document_exists`      | That filename is already claimed on the plan.         |
| `uploadDocument` request  | `409`  | `plan_not_open`        | The plan no longer accepts documents.                 |
| `uploadDocument` request  | `409`  | `source_limit_reached` | The plan already holds 20 documents.                  |
| `uploadDocument` request  | `409`  | `upload_in_progress`   | Lost a race with a concurrent identical request.      |
| `getDocumentUploadStatus` | `400`  | `invalid_target`       | Unrecognised, superseded, or not yours. Not a retry.  |
| Any call                  | `401`  | -                      | Retried once internally with a fresh token.           |

`upload_in_progress` is the only one of these worth retrying automatically -- it's a
lost race, not a policy decision, and asking again supersedes the previous grant. Every
other refusal needs something changed first, not a retry.

## What will not change

Worth building around, because these are decisions rather than implementation details.

- Your identifiers are the handles. VITA's internal identifiers never cross the boundary
  in either direction.
- A repeated `planId` is refused, never duplicated.
- Bytes go to VITA's storage directly, never through the partner API.
- A successful upload is not an attached document -- attaching happens afterwards, on
  VITA's own worker.
- Delegated tokens are short-lived. Withdrawing an authority stops activity within
  minutes, without a deployment on either side.

## What is still open

- Whether a checksum is required with an upload request, and which algorithm.
- Whether the client ships as a published npm package, or stays a mirrored source
  directory for vendoring.

## Sources

See `README.md` in this directory for the client's own behaviour.
