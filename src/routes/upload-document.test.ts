import { PartnerApiClient } from '../PartnerApiClient';
import { CONFIG, jsonResponse, tokenBody } from '../__fixtures__/http';

describe('PartnerApiClient#uploadDocument', () => {
  const REQUEST = {
    filename: 'report.pdf',
    contentType: 'application/pdf',
    contentLength: 1024,
  };

  const grantedBody = () => ({
    upload: {
      uploadId: 'upload-1',
      url: 'https://s3.example.com/upload',
      headers: {
        'Content-Type': 'application/pdf',
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
