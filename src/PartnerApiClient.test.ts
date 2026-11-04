import { PartnerApiClient } from './PartnerApiClient';
import { PartnerApiError } from './errors';
import { CONFIG, jsonResponse, tokenBody } from './__fixtures__/http';

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
