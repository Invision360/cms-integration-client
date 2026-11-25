import { PartnerApiClient } from '../PartnerApiClient';
import { PartnerApiError } from '../errors';
import { CONFIG, jsonResponse, tokenBody } from '../__fixtures__/http';

describe('PartnerApiClient#requestDocumentUpload', () => {
  const REQUEST = {
    filename: 'report.pdf',
    contentType: 'application/pdf',
    contentLength: 1024,
  };

  const grantedBody = () => ({
    upload: {
      uploadId: 'upload-1',
      url: 'https://s3.example.com/upload',
      headers: { 'Content-Type': 'application/pdf' },
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
