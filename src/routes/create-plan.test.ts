import { PartnerApiClient } from '../PartnerApiClient';
import { PartnerApiError } from '../errors';
import { CONFIG, jsonResponse, tokenBody } from '../__fixtures__/http';

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
