# Partner API client

A server-side TypeScript client for the VITA partner API. Handles actor token caching and refresh,
delegated token exchange, identity lookups and creating plans, so an integrating deployment
doesn't implement OAuth token-exchange itself.

Must run server-side only. `clientSecret` would be exposed to a browser otherwise.

## Quick start

You'll need four values from VITA before you can connect: `apiUrl`, `tokenEndpoint`, `clientId`,
and `clientSecret`. These are issued when your organisation is attached as a CMS integration.

The first thing to try once you have credentials: connect as your deployment's own actor and look
up its identity. If this succeeds, your configuration is correct.

```ts
import { PartnerApiClient } from '@invision360/vita-ehcp-cms-client';

const client = new PartnerApiClient({
  apiUrl: 'https://api.vita.example/v1',
  tokenEndpoint: 'https://vita.auth.eu-west-2.amazoncognito.com/oauth2/token',
  clientId: process.env.VITA_CLIENT_ID!,
  clientSecret: process.env.VITA_CLIENT_SECRET!,
});

const actorToken = await client.getActorToken();
const identity = await client.getIdentity(actorToken);
// {
//   actor: { type: 'partner_deployment', provider: 'IDOX', clientId: '...' },
//   authority: { name: 'Some Council' },
//   integration: { attachedAt: '2026-01-01T00:00:00.000Z' },
// }
```

An optional `fetch` override is accepted for testing; it defaults to the global `fetch`.

## Looking up a user

`getMe` mints the delegated token for you and reports who a user reference is and what they may
do. Roles are read live on every call, unlike a delegated token's own role claim, so a demotion is
reflected on the next call.

```ts
const me = await client.getMe('user-ref-48213');
// {
//   user: { id: 'user-ref-48213', userRoles: ['ADMIN'] },
//   authority: { name: 'Some Council' },
// }
```

## Creating a plan

`createPlan` is the whole journey in one call: it mints your actor token, exchanges it for a
delegated token naming the coordinator acting, and posts the plan. You handle no tokens.

```ts
const plan = await client.createPlan('user-ref-48213', {
  planId: '5512_7',
  caseIdentifier: '5512',
  dueOn: '2026-12-01',
  assigneeId: 'user-ref-99001',
});
// {
//   id: '5512_7',
//   caseIdentifier: '5512',
//   dueOn: '2026-12-01',
//   assignee: { id: 'user-ref-99001' },
// }
```

The first argument is the user reference the plan is created _as_; `assigneeId` is the user
reference it is assigned _to_. They are often the same. Assigning to anyone else requires the
acting user to hold VITA's administrator role -- the same rule a coordinator meets working in VITA
directly -- and is a `403` otherwise. Both references must be mapped in your attachment.

`planId` is yours and opaque to us; nothing on our side parses it. `caseIdentifier` is what a
coordinator reads on the plan. Nothing in the response is a VITA identifier, and there is no VITA
plan id to store: later calls about this plan name it by `planId`.

**Retrying is safe.** A repeated `planId` never creates a second plan -- it comes back as a `409`
with code `plan_exists`. So after a network timeout, send the same request again: either it
succeeds, or the `409` tells you the first attempt had already landed.

## Uploading a document

`uploadDocument` mints both tokens, requests permission to attach a document, and PUTs the bytes to
the granted URL, all in one call. You hand over bytes; the client handles the token, the grant, and
the signed URL.

```ts
const upload = await client.uploadDocument(
  'user-ref-48213',
  '5512_7',
  {
    filename: 'report.pdf',
    contentType: 'application/pdf',
    contentLength: bytes.length,
  },
  bytes,
);
// { url, headers, expiresAt }
```

`contentLength` must match `bytes.length` exactly -- it's part of what VITA signs into the grant.
The grant expires 15 minutes after issue; the PUT itself is a raw S3 request, so a rejected upload
surfaces as a `PartnerApiError` with `kind: 'http'` and no `code`.

If you'd rather perform the PUT yourself (streaming from disk, a different HTTP client), call
`requestDocumentUpload` directly for just the grant -- `uploadDocument` is a convenience wrapper
around it, not the only way to upload.

## Handling errors

Every failure is a `PartnerApiError` with a `kind`, safe to log since its message never echoes
your request:

```ts
import { PartnerApiError } from '@invision360/vita-ehcp-cms-client';

try {
  await client.getDelegatedToken('user-ref-48213');
} catch (err) {
  if (err instanceof PartnerApiError) {
    switch (err.kind) {
      case 'network':
        // retry
        break;
      case 'http':
        // err.statusCode, err.code (e.g. 'invalid_target', 'invalid_request')
        // For a 400 invalid_request from a schema validation failure,
        // err.details is a field name -> messages map (e.g.
        // { planId: ['Required'] }); undefined otherwise.
        break;
      case 'malformed-response':
        // unexpected shape. Treat as a bug, not a retryable failure
        break;
    }
  }
}
```

A `401` from `getDelegatedToken` is retried once internally with a fresh actor token before it
reaches you. If you still see one, your actor credential itself is invalid. `invalid_target` means
the user reference isn't mapped or is otherwise unusable, and needs provisioning on the VITA side,
not a retry.

`createPlan` retries a `401` once with a fresh delegated token, since one lives 15 minutes. Its
other statuses are worth telling apart:

| Status | `code`                 | Meaning                                                                                         |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `400`  | `invalid_target`       | A named user isn't mapped. Needs provisioning, never a retry.                                   |
| `400`  | `invalid_request`      | The request itself is wrong -- a missing field, or a malformed date. `err.details` names which. |
| `403`  | `assignment_forbidden` | The acting user may not assign to others.                                                       |
| `403`  | -                      | Your deployment is not attached to an active authority.                                         |
| `409`  | `plan_exists`          | This `planId` already has a plan.                                                               |

## About this mirror

This repository is generated from a private monorepo and mirrors the `amplify/integration/client`
directory verbatim on every change. It's provided as a reference implementation for partners
porting the client to another language. Pull requests and issues aren't accepted here; open them
against your own integration instead.

## Licence

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). This grants no trademark licence, and
covers only this directory -- it does not make the wider VITA platform open source.
