# Worked example: contributing case documents to VITA

An end-to-end sketch of the machine-to-machine flow, for partner engineers. Create a
plan for a case, send its documents, and find out what happened to each one.

## Read this first

**Only the first two steps exist today.** `getActorToken`, `getDelegatedToken` and
`getIdentity` are built and callable against a VITA sandbox, but may change slightly. Everything from "Create the plan" onwards is designed but not yet implemented. Exact request and response shapes may move before they ship.

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
VITA links it to a VITA user. An unmapped coordinator is refused at step 1, and that is a
provisioning problem to fix rather than an error to retry.

All of this runs server side. `clientSecret` must never reach a browser.

## The flow

```
0. Connect            client credentials  ->  actor token          (cached, ~1 hour)
1. Act for a person   actor token         ->  delegated token      (15 minutes)
2. Create the plan    caseReference       ->  plan exists
3. Request a slot     filename, size      ->  uploadId + upload destination
4. Transfer bytes     straight to storage, not through the API
5. Check status       uploadId            ->  PENDING | PROCESSING | COMPLETED | FAILED | EXPIRED
```

Steps 3 to 5 repeat per document. Step 1's token is reusable for its 15 minutes, so a
case with eight documents needs one exchange, not eight.

---

## Step 0: connect

```ts
import { createPartnerApiClient } from './vita-partner-client';

const vita = createPartnerApiClient({
  apiUrl: process.env.VITA_API_URL!, // already includes /v1
  tokenEndpoint: process.env.VITA_TOKEN_ENDPOINT!,
  clientId: process.env.VITA_CLIENT_ID!,
  clientSecret: process.env.VITA_CLIENT_SECRET!,
});
```

The current SDK client mints and caches the actor token itself, refreshes it before expiry, and shares one in-flight refresh across concurrent callers. Ideally this will abstract credential management.

Worth doing once at integration time: call `getIdentity` with an actor token and check
the authority you get back is the one this deployment is meant to serve. A misfiled
credential otherwise surfaces much later.

```ts
const identity = await vita.getIdentity(await vita.getActorToken());
// { actor: { type, provider, clientId }, authority: { name }, integration: { attachedAt } }
```

## Step 1: act for a coordinator

```ts
const delegated = await vita.getDelegatedToken(coordinator.vitaUserRef);
// { accessToken, tokenType: 'Bearer', expiresIn: 900 }
```

Use `delegated.accessToken` as the bearer token for everything that follows. It names
both your deployment and that coordinator, and VITA records both against every action
taken with it.

Not cached in this example: you could decide whether to reuse one within its 15
minutes. Reuse it across the documents of a single case.

A `401` here is retried once internally with a fresh actor token. If one still reaches
you, the actor credential itself is bad. `invalid_target` means the coordinator is not
mapped: fix the mapping, do not retry.

## Step 2: create the plan

> Not built.

```ts
const plan = await vita.createPlan(delegated.accessToken, {
  caseReference: `${caseId}_${firstPlanId}`,
  dueOn: '2026-11-30',
  assigneeReference: coordinatorReference, // as mapped to VITA during onboarding
});
```

`caseReference` is yours and becomes your handle for this plan. Composite, because a
VITA plan corresponds to your Case plus its first Plan. It is scoped to your authority,
so it need not be unique beyond it.

`assigneeReference` is a mapped coordinator, and VITA applies its own rule: a
coordinator may assign a plan to themselves, and only a VITA administrator may assign
one to someone else. The same rule applies when a caseworker does this inside VITA, so
it is not an integration restriction.

**Sending the same `caseReference` twice is refused, never duplicated.** That makes this
call safe to retry after a network timeout: if you did not see the response, send it
again. Either it creates the plan or it tells you the plan already exists, and both
outcomes are ones you can proceed from.

## Step 3: request an upload slot

> Not built.

One request per document, before any bytes move.

```ts
const slot = await vita.requestDocumentUpload(delegated.accessToken, {
  caseReference,
  filename: 'ep-advice.pdf',
  contentType: 'application/pdf',
  contentLength: file.size,
});
// { uploadId, uploadUrl, fields, expiresIn }
```

VITA checks what it can here rather than after the transfer, so your UI can tell the
coordinator immediately. Refused at this point: an unaccepted content type, a file over
the size ceiling, a filename already on the plan, a plan no longer open to
contributions, and a `caseReference` with no plan.

Current limits, (which may be pinned in the OpenAPI document):

| Rule                            | Value                                                          |
| ------------------------------- | -------------------------------------------------------------- |
| Content types                   | `application/pdf`, `application/msword`, `.docx`, `text/plain` |
| Size ceiling                    | 20 MB per file                                                 |
| Documents per plan              | 20                                                             |
| Duplicate filenames on one plan | Refused                                                        |
| Slot lifetime                   | Short-lived, single use                                        |

Your 50 MB ceiling is higher than ours. Documents between the two need handling on your
side, and we would rather that surfaced in your UI than as a failed transfer.

**Keep the `uploadId`.** It is the only handle for step 5, and it needs to outlive the
browser session that started the upload.

## Step 4: transfer the bytes

Straight to storage, using the destination from step 3. Not through the VITA API, (which
caps and has large payload restrictions)

```ts
const form = new FormData();
for (const [key, value] of Object.entries(slot.fields)) form.append(key, value);
form.append('file', fileStream);

const response = await fetch(slot.uploadUrl, { method: 'POST', body: form });
// 204 No Content on success
```

The destination carries signed conditions, so storage itself rejects a transfer that
does not match what you declared in step 3. A rejection here means the declaration and
the file disagree, or the slot expired. Request a new slot rather than retrying the old
one.

**A successful transfer is not an attached document.** The bytes have landed; VITA
attaches them to the plan asynchronously and may still refuse, most commonly on the
document-count limit. That is what step 5 is for. There is no second call for you to
make: once the bytes land, attaching them is VITA's responsibility, so a dropped
connection at this point cannot strand a document half-submitted.

## Step 5: check the status

> Not built.

```ts
const upload = await vita.getUploadStatus(delegated.accessToken, uploadId);
// { uploadId, status, error?: { code, message } }
```

| Status       | Meaning                                           | Terminal |
| ------------ | ------------------------------------------------- | -------- |
| `PENDING`    | Slot issued, file not arrived                     | No       |
| `PROCESSING` | File arrived, validation running                  | No       |
| `COMPLETED`  | Accepted and attached to the plan                 | Yes      |
| `FAILED`     | Finished unsuccessfully, with a stable error code | Yes      |
| `EXPIRED`    | Slot was not used in time                         | Yes      |

Stop on any terminal status. Read `error.code` rather than `error.message` when deciding
what to show and whether to offer a retry: the code is stable, the message is for a
human.

A reasonable schedule is 1, 2, 3, 5, 8, 12 seconds, then every 15, with a little random
variation if you may have many uploads in flight at once. Do not hold a user-facing
request open while waiting. If your UI gives up before a terminal status, that is a UI
timeout and not a failure: processing continues, and the coordinator can check again
later using the stored `uploadId`.

### Why polling and not a callback

We looked hard at VITA calling you when processing finishes, and decided against it for
now. It reverses the authentication direction, so VITA needs a credential for each of
your deployments and you need to verify the caller really is VITA. Adding an authority
stops being a config change on your side and becomes a bilateral exchange of URLs and
secrets. And a callback is only useful if it is reliable, which means a queue, a retry
policy, a dead letter queue, someone watching it, and a replay route for missed events,
on both sides. Polling needs none of that, because the next request simply asks again.

If we add callbacks later, this endpoint stays the source of truth and the callback
becomes a hint to re-read it. Your client code would not have to change.

---

## Putting it together

```ts
async function submitCaseToVita(caseRecord, coordinator, documents) {
  const delegated = await vita.getDelegatedToken(coordinator.vitaUserRef);
  const caseReference = `${caseRecord.id}_${caseRecord.firstPlanId}`;

  await vita.createPlan(delegated.accessToken, {
    caseReference,
    dueOn: caseRecord.statutoryDeadline,
    assigneeReference: coordinator.vitaUserRef,
  });

  for (const document of documents) {
    const slot = await vita.requestDocumentUpload(delegated.accessToken, {
      caseReference,
      filename: document.filename,
      contentType: document.contentType,
      contentLength: document.size,
    });

    await transferToStorage(slot, document);

    // Persist against your own case record. The coordinator may close the tab.
    await uploads.record({
      caseId: caseRecord.id,
      uploadId: slot.uploadId,
      filename: document.filename,
      status: 'PENDING',
    });
  }
}
```

Status checking then runs separately, against the stored `uploadId`s, either from your
frontend through a thin backend facade or from a background worker. Either works. A
worker suits you better if the outcome has to be recorded whether or not a browser is
open.

```ts
async function checkUpload(uploadId, attempt) {
  const delegated = await vita.getDelegatedToken(coordinatorRefFor(uploadId));
  const upload = await vita.getUploadStatus(delegated.accessToken, uploadId);

  await uploads.update(uploadId, upload);
  if (TERMINAL.has(upload.status)) return;

  await jobs.schedule(
    'check-vita-upload',
    { uploadId, attempt: attempt + 1 },
    Math.min(backoff(attempt), 30),
  );
}
```

## Handling errors

Every failure from the client is a `PartnerApiError`, and its message is built only from
the response, never from your request, so it is always safe to log.

```ts
try {
  await vita.getDelegatedToken(ref);
} catch (err) {
  if (err instanceof PartnerApiError) {
    switch (err.kind) {
      case 'network':
        break; // retry
      case 'http':
        break; // err.statusCode, err.code
      case 'malformed-response':
        break; // a bug, not a retryable failure
    }
  }
}
```

| What you see            | What it means                                 | What to do                                                            |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `401`                   | The actor credential is invalid or expired    | Check the credential. The client already retried once                 |
| `403`                   | Authenticated, but not permitted              | Do not retry. Raise it with us                                        |
| `invalid_target`        | The coordinator is not mapped, or is unusable | Provisioning. Do not retry                                            |
| `invalid_request`       | Malformed exchange request                    | A bug on one side. Do not retry                                       |
| `409` on create-plan    | That case already has a plan                  | Proceed. This is the safe-retry outcome                               |
| `409` on upload request | That filename is already on the plan          | Rename or skip                                                        |
| `422` on upload request | The plan is not open to contributions         | Do not retry                                                          |
| Network failure         | Nothing was learned about the outcome         | Retry. Step 2 is safe to repeat; for steps 3 to 5, check status first |

An expired credential stays a `401` while a provisioning problem is a `400` with a
code, precisely so you can tell a retryable failure from one that needs a human.

## What will not change

Worth building around, because these are decisions rather than implementation details.

- Your identifiers are the handles. VITA's internal identifiers never cross the boundary
  in either direction.
- A repeated `caseReference` is refused, never duplicated.
- Bytes go to storage directly, never through the API.
- A successful transfer is not an attached document.
- Delegated tokens are short-lived. Withdrawing an authority stops activity within
  minutes, without a deployment on either side.

## What is still open

- The exact request and response shapes for steps 2 to 5.
- Whether a checksum is required with an upload request, and which algorithm.
- Which plan states close a plan to contributions.
- Whether the client ships as a published package or as vendored source.

## Sources

Derived from the Architecture response (polling versus callbacks, and the five status
values) and ADR 2 - CMS File Transfer (external reference mapping, presigned upload,
event-driven attachment, pull feedback), reconciled against what is actually built in
`amplify/integration/`. See `README.md` in this directory for the client's own
behaviour, and the repository's `CONTEXT.md` for the vocabulary above.
