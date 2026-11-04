import { PartnerApiClient } from '../PartnerApiClient';
import { PartnerApiError } from '../errors';
import {
  CONFIG,
  jsonResponse,
  tokenBody,
  delegatedTokenBody,
  meBody,
} from '../__fixtures__/http';

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
