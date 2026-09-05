# Partner API client

A server-side TypeScript client for the VITA partner API. Handles actor token caching and refresh,
delegated token exchange, and identity lookups, so an integrating deployment doesn't implement
OAuth token-exchange itself.

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
//   // no `subject` -- an actor token names no user
// }
```

An optional `fetch` override is accepted for testing; it defaults to the global `fetch`.

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

## About this mirror

This repository is generated from a private monorepo and mirrors the `amplify/integration/client`
directory verbatim on every change. It's provided as a reference implementation for partners
porting the client to another language. Pull requests and issues aren't accepted here; open them
against your own integration instead.

## Licence

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). This grants no trademark licence, and
covers only this directory -- it does not make the wider VITA platform open source.
