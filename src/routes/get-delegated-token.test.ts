import { PartnerApiClient } from '../PartnerApiClient';
import {
  CONFIG,
  jsonResponse,
  tokenBody,
  delegatedTokenBody,
} from '../__fixtures__/http';

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
