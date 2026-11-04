import { PartnerApiClient } from '../PartnerApiClient';
import { PartnerApiError } from '../errors';
import { CONFIG, jsonResponse, identityBody } from '../__fixtures__/http';

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
