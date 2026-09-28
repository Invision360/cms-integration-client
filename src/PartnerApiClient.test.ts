import { PartnerApiClient } from './PartnerApiClient';
import { PartnerApiError } from './errors';

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

  it('surfaces error_details when the body carries a valid one', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'invalid_request',
            error_description: 'planId: Required',
            error_details: { planId: ['Required'] },
          },
          false,
          400,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getDelegatedToken('48213')).rejects.toMatchObject({
      details: { planId: ['Required'] },
    });
  });

  it('drops a malformed error_details rather than trusting the server shape', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'invalid_request',
            error_details: { planId: 'not-an-array' },
          },
          false,
          400,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const error = await client.getDelegatedToken('48213').catch(e => e);
    expect(error.details).toBeUndefined();
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

const meBody = () => ({
  user: { id: '48213', userRoles: ['ADMIN'] },
  authority: { name: 'Acme' },
});

describe('PartnerApiClient#getMe', () => {
  it('mints a delegated token and parses the me response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()))
      .mockResolvedValueOnce(jsonResponse(meBody()));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const me = await client.getMe('48213');

    expect(me).toEqual(meBody());
    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe(`${CONFIG.apiUrl}/me`);
    expect(init.headers.Authorization).toBe('Bearer delegated-token');
  });

  it('retries once with a fresh delegated token on a 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()))
      .mockResolvedValueOnce(jsonResponse({}, false, 401))
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()))
      .mockResolvedValueOnce(jsonResponse(meBody()));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const me = await client.getMe('48213');

    expect(me).toEqual(meBody());
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('surfaces a refusal as a typed PartnerApiError', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedTokenBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: 'This client is not attached to an active authority.' },
          false,
          403,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getMe('48213')).rejects.toMatchObject({
      kind: 'http',
      statusCode: 403,
    });
  });
});

describe('PartnerApiClient#createPlan', () => {
  const PLAN = {
    planId: '5512_7',
    caseIdentifier: '5512',
    dueOn: '2026-12-01',
    assigneeId: '99001',
  };

  const createdBody = () => ({
    plan: {
      id: '5512_7',
      caseIdentifier: '5512',
      dueOn: '2026-12-01',
      assignee: { id: '99001' },
    },
  });

  const delegatedBody = (token = 'delegated-token') => ({
    access_token: token,
    token_type: 'Bearer',
    expires_in: 900,
  });

  it('mints both tokens and posts the plan as the acting user', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse(createdBody(), true, 201));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const plan = await client.createPlan('48213', PLAN);

    // The caller handled no token of its own.
    expect(plan).toEqual(createdBody().plan);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe(`${CONFIG.apiUrl}/plans`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer delegated-token');
    expect(JSON.parse(init.body as string)).toEqual(PLAN);
  });

  it('returns no VITA identifier, only the partner reference', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse(createdBody(), true, 201));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const plan = await client.createPlan('48213', PLAN);

    expect(plan.id).toBe(PLAN.planId);
    expect(plan).not.toHaveProperty('planId');
    expect(plan).not.toHaveProperty('planReferenceId');
  });

  it('surfaces a repeated reference as a 409 with its error code', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'plan_exists',
            error_description: 'This case reference already has a plan.',
          },
          false,
          409,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.createPlan('48213', PLAN)).rejects.toMatchObject({
      kind: 'http',
      statusCode: 409,
      code: 'plan_exists',
    });
  });

  it('surfaces an unmapped assignee as invalid_target, not a 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'invalid_target' }, false, 400),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.createPlan('48213', PLAN)).rejects.toMatchObject({
      kind: 'http',
      statusCode: 400,
      code: 'invalid_target',
    });
  });

  it('retries once with a fresh delegated token on a 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody('stale')))
      .mockResolvedValueOnce(jsonResponse({}, false, 401))
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody('fresh')))
      .mockResolvedValueOnce(jsonResponse(createdBody(), true, 201));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const plan = await client.createPlan('48213', PLAN);

    expect(plan).toEqual(createdBody().plan);
    // The 401 was rejected before a plan was created, so the retry cannot
    // duplicate one.
    expect(fetchImpl.mock.calls[5][1].headers.Authorization).toBe(
      'Bearer fresh',
    );
  });

  it('does not retry a 409, which would not change the outcome', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'plan_exists' }, false, 409),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.createPlan('48213', PLAN)).rejects.toBeInstanceOf(
      PartnerApiError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects a response of an unexpected shape as malformed', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse({ plan: {} }, true, 201));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.createPlan('48213', PLAN)).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it('surfaces a transport failure as a network error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockRejectedValueOnce(new Error('socket hang up'));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.createPlan('48213', PLAN)).rejects.toMatchObject({
      kind: 'network',
    });
  });
});

describe('PartnerApiClient#requestDocumentUpload', () => {
  const REQUEST = {
    filename: 'report.pdf',
    contentType: 'application/pdf',
    contentLength: 1024,
  };

  const grantedBody = () => ({
    upload: {
      url: 'https://s3.example.com/upload',
      headers: { 'x-amz-meta-grant-id': 'grant-1' },
      expiresAt: '2026-01-01T00:15:00.000Z',
    },
  });

  const delegatedBody = (token = 'delegated-token') => ({
    access_token: token,
    token_type: 'Bearer',
    expires_in: 900,
  });

  it('mints both tokens and posts the request as the acting user', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse(grantedBody(), true, 201));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const upload = await client.requestDocumentUpload(
      '48213',
      '5512_7',
      REQUEST,
    );

    expect(upload).toEqual(grantedBody().upload);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe(`${CONFIG.apiUrl}/plans/5512_7/documents`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer delegated-token');
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it('surfaces a 409 as a typed PartnerApiError with its error code, never retried', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'document_exists',
            error_description:
              'A document with this filename already exists on the plan.',
          },
          false,
          409,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(
      client.requestDocumentUpload('48213', '5512_7', REQUEST),
    ).rejects.toMatchObject({
      kind: 'http',
      statusCode: 409,
      code: 'document_exists',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries once with a fresh delegated token on a 401', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody('stale')))
      .mockResolvedValueOnce(jsonResponse({}, false, 401))
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody('fresh')))
      .mockResolvedValueOnce(jsonResponse(grantedBody(), true, 201));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const upload = await client.requestDocumentUpload(
      '48213',
      '5512_7',
      REQUEST,
    );

    expect(upload).toEqual(grantedBody().upload);
    expect(fetchImpl.mock.calls[5][1].headers.Authorization).toBe(
      'Bearer fresh',
    );
  });

  it('surfaces a transport failure as a network error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockRejectedValueOnce(new Error('socket hang up'));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(
      client.requestDocumentUpload('48213', '5512_7', REQUEST),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('PartnerApiClient#uploadDocument', () => {
  const REQUEST = {
    filename: 'report.pdf',
    contentType: 'application/pdf',
    contentLength: 1024,
  };

  const grantedBody = () => ({
    upload: {
      url: 'https://s3.example.com/upload',
      headers: {
        'Content-Type': 'application/pdf',
        'x-amz-meta-grant-id': 'grant-1',
      },
      expiresAt: '2026-01-01T00:15:00.000Z',
    },
  });

  const delegatedBody = () => ({
    access_token: 'delegated-token',
    token_type: 'Bearer',
    expires_in: 900,
  });

  it('requests the grant, then PUTs the body to the granted URL with its headers', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse(grantedBody(), true, 201))
      .mockResolvedValueOnce(jsonResponse({}, true, 200));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });
    const body = new Uint8Array([1, 2, 3]);

    const upload = await client.uploadDocument(
      '48213',
      '5512_7',
      REQUEST,
      body,
    );

    expect(upload).toEqual(grantedBody().upload);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [url, init] = fetchImpl.mock.calls[3];
    expect(url).toBe('https://s3.example.com/upload');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual(grantedBody().upload.headers);
    expect(init.body).toBe(body);
  });

  it('surfaces a rejected upload as a plain http error, with no VITA error code', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse(grantedBody(), true, 201))
      .mockResolvedValueOnce({ ok: false, status: 403 } as unknown as Response);
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(
      client.uploadDocument('48213', '5512_7', REQUEST, 'bytes'),
    ).rejects.toMatchObject({ kind: 'http', statusCode: 403, code: undefined });
  });

  it('surfaces a transport failure during the PUT as a network error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse(grantedBody(), true, 201))
      .mockRejectedValueOnce(new Error('socket hang up'));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(
      client.uploadDocument('48213', '5512_7', REQUEST, 'bytes'),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('never reaches the PUT when the upload request itself is refused', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'document_exists' }, false, 409),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(
      client.uploadDocument('48213', '5512_7', REQUEST, 'bytes'),
    ).rejects.toMatchObject({ kind: 'http', statusCode: 409 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
