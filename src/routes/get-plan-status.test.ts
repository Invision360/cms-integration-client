import { PartnerApiClient } from '../PartnerApiClient';
import { PartnerApiError } from '../errors';
import { CONFIG, jsonResponse, tokenBody } from '../__fixtures__/http';

describe('PartnerApiClient#getPlanStatus', () => {
  const delegatedBody = {
    access_token: 'delegated-token',
    token_type: 'Bearer',
    expires_in: 900,
  };

  const planBody = (status = 'open') => ({
    plan: {
      id: '5512_7',
      status,
      updatedAt: '2026-09-10T09:00:00.000Z',
      message: 'The plan is open and accepts documents.',
    },
  });

  it('mints a delegated token and reads the plan by its reference', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody))
      .mockResolvedValueOnce(jsonResponse(planBody(), true, 200));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const plan = await client.getPlanStatus('48213', '5512_7');

    expect(plan).toEqual(planBody().plan);
    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe(`${CONFIG.apiUrl}/plans/5512_7`);
    expect(init.headers.Authorization).toBe('Bearer delegated-token');
  });

  it('encodes the plan reference in the path', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody))
      .mockResolvedValueOnce(jsonResponse(planBody(), true, 200));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await client.getPlanStatus('48213', 'a/b c');

    expect(fetchImpl.mock.calls[2][0]).toBe(`${CONFIG.apiUrl}/plans/a%2Fb%20c`);
  });

  it('rejects a status the client does not know', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody))
      .mockResolvedValueOnce(jsonResponse(planBody('nonsense'), true, 200));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(client.getPlanStatus('48213', '5512_7')).rejects.toMatchObject(
      { kind: 'malformed-response' },
    );
  });

  it.each([
    [404, 'not_found'],
    [403, 'plan_forbidden'],
  ])(
    'surfaces a %s as a typed PartnerApiError, never retried',
    async (statusCode, code) => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody()))
        .mockResolvedValueOnce(jsonResponse(delegatedBody))
        .mockResolvedValueOnce(
          jsonResponse({ error: code }, false, statusCode),
        );
      const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

      await expect(
        client.getPlanStatus('48213', '5512_7'),
      ).rejects.toMatchObject({ kind: 'http', statusCode, code });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    },
  );
});
