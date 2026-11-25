import { PartnerApiClient } from '../PartnerApiClient';
import { PartnerApiError } from '../errors';
import { CONFIG, jsonResponse, tokenBody } from '../__fixtures__/http';

describe('PartnerApiClient#getDocumentUploadStatus', () => {
  const delegatedBody = (token = 'delegated-token') => ({
    access_token: token,
    token_type: 'Bearer',
    expires_in: 900,
  });

  const statusBody = (status = 'PENDING') => ({
    upload: { uploadId: 'upload-1', status, error: null },
  });

  it('mints a delegated token and polls by uploadId', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(jsonResponse(statusBody(), true, 200));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const status = await client.getDocumentUploadStatus('48213', 'upload-1');

    expect(status).toEqual(statusBody().upload);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe(`${CONFIG.apiUrl}/uploads/upload-1`);
    expect(init.headers.Authorization).toBe('Bearer delegated-token');
  });

  it('surfaces FAILED with its error code', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            upload: {
              uploadId: 'upload-1',
              status: 'FAILED',
              error: {
                code: 'content_mismatch',
                description: 'The bytes did not match.',
              },
            },
          },
          true,
          200,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const status = await client.getDocumentUploadStatus('48213', 'upload-1');

    expect(status.status).toBe('FAILED');
    expect(status.error).toEqual({
      code: 'content_mismatch',
      description: 'The bytes did not match.',
    });
  });

  it('surfaces a 400 as a typed PartnerApiError with its error code, never retried', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'invalid_target',
            error_description:
              'The named user could not be provisioned for this integration.',
          },
          false,
          400,
        ),
      );
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    await expect(
      client.getDocumentUploadStatus('48213', 'no-such-upload'),
    ).rejects.toMatchObject({
      kind: 'http',
      statusCode: 400,
      code: 'invalid_target',
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
      .mockResolvedValueOnce(jsonResponse(statusBody(), true, 200));
    const client = new PartnerApiClient({ ...CONFIG, fetch: fetchImpl });

    const status = await client.getDocumentUploadStatus('48213', 'upload-1');

    expect(status).toEqual(statusBody().upload);
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
      client.getDocumentUploadStatus('48213', 'upload-1'),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});
