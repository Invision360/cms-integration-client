import { PartnerApiClient } from './PartnerApiClient';

const CONFIG = {
  apiUrl: 'https://api.example.com',
  tokenEndpoint: 'https://cognito.example.com/oauth2/token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => body,
  }) as Response;

const tokenBody = (expiresIn = 3600) => ({
  access_token: 'actor-token',
  token_type: 'Bearer',
  expires_in: expiresIn,
});

const delegatedTokenBody = (expiresIn = 900) => ({
  access_token: 'delegated-token',
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  token_type: 'Bearer',
  expires_in: expiresIn,
});

const identityBody = () => ({
  actor: {
    type: 'partner_deployment',
    provider: 'IDOX',
    clientId: 'client-id',
  },
  authority: { name: 'Acme' },
  integration: { attachedAt: '2026-01-01T00:00:00.000Z' },
  subject: { partnerUserRef: '48213' },
});

describe('PartnerApiClient#getDelegatedToken', () => {
  it('sends the RFC 8693 exchange with the cached actor token as bearer', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const result = await client.getDelegatedToken('48213');

    expect(result).toEqual({
      accessToken: 'delegated-token',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe(`${CONFIG.apiUrl}/token`);
    expect(init.headers.Authorization).toBe('Bearer actor-token');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:token-exchange',
    );
    expect(body.get('subject_token')).toBe('48213');
    expect(body.get('subject_token_type')).toBe(
      'urn:invision360:params:oauth:token-type:partner-user-reference',
    );
  });

  it('reuses one cached actor token across repeated exchanges', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await client.getDelegatedToken('48213');
    await client.getDelegatedToken('99999');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries once with a fresh actor token on a 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse({}, false, 401))
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const result = await client.getDelegatedToken('48213');

    expect(result.accessToken).toBe('delegated-token');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not retry a 400 invalid_target and surfaces it as a typed error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'invalid_target',
            error_description: 'The named user could not be provisioned.',
          },
          false,
          400,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getDelegatedToken('unmapped')).rejects.toMatchObject({
      kind: 'http',
      statusCode: 400,
      code: 'invalid_target',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry an opaque 403 refusal', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(
        jsonResponse({ message: 'not attached' }, false, 403),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getDelegatedToken('ref')).rejects.toMatchObject({
      kind: 'http',
      statusCode: 403,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('PartnerApiClient#getIdentity', () => {
  it('sends a bearer token and parses the identity response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(identityBody()));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const identity = await client.getIdentity('some-access-token');

    expect(identity).toEqual(identityBody());
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${CONFIG.apiUrl}/identity`);
    expect(init.headers.Authorization).toBe('Bearer some-access-token');
  });

  it('surfaces a refusal as a typed PartnerApiError', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { message: 'This client is not attached to an active authority.' },
          false,
          403,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getIdentity('token')).rejects.toMatchObject({
      kind: 'http',
      statusCode: 403,
    });
  });
});

describe('PartnerApiClient#getActorToken', () => {
  it('delegates to the actor token cache', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(tokenBody()));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getActorToken()).resolves.toBe('actor-token');
  });

  it('wraps a network failure as a PartnerApiError', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getActorToken()).rejects.toMatchObject({
      kind: 'network',
    });
  });
});
