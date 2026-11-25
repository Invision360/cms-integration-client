/** Shared by the per-route client test files. */
export const CONFIG = {
  apiUrl: 'https://api.example.com',
  tokenEndpoint: 'https://cognito.example.com/oauth2/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

export const jsonResponse = (
  body: unknown,
  ok = true,
  status = 200,
): Response =>
  ({
    ok,
    status,
    json: async () => body,
  }) as Response;

export const tokenBody = (expiresIn = 3600) => ({
  access_token: 'actor-token',
  token_type: 'Bearer',
  expires_in: expiresIn,
});

export const delegatedTokenBody = (expiresIn = 900) => ({
  access_token: 'delegated-token',
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  token_type: 'Bearer',
  expires_in: expiresIn,
});

export const identityBody = () => ({
  actor: {
    type: 'partner_deployment',
    provider: 'IDOX',
    clientId: 'client-id',
  },
  authority: { name: 'Acme' },
  integration: { attachedAt: '2026-01-01T00:00:00.000Z' },
});

export const meBody = () => ({
  user: { id: '48213', userRoles: ['ADMIN'] },
  authority: { name: 'Acme' },
});
