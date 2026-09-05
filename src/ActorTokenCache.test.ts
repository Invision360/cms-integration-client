import { ActorTokenCache } from './ActorTokenCache';
import { PartnerApiError } from './errors';

const CONFIG = {
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

describe('ActorTokenCache#get', () => {
  it('requests a client-credentials token with Basic auth and no scope', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(tokenBody()));

    await new ActorTokenCache(CONFIG, fetchImpl).get();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(CONFIG.tokenEndpoint);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(
      'Basic ' + Buffer.from('client-id:client-secret').toString('base64'),
    );
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.has('scope')).toBe(false);
  });

  it('caches the token and does not refetch before expiry', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(tokenBody()));
    const cache = new ActorTokenCache(CONFIG, fetchImpl);

    const first = await cache.get();
    const second = await cache.get();

    expect(first).toBe('actor-token');
    expect(second).toBe('actor-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats the token as expired 30 seconds before expires_in', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody(30)))
      .mockResolvedValueOnce(jsonResponse(tokenBody(3600)));
    const cache = new ActorTokenCache(CONFIG, fetchImpl);

    await cache.get();
    await cache.get();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let resolveFetch: (response: Response) => void;
    const fetchImpl = jest.fn().mockReturnValue(
      new Promise<Response>(resolve => {
        resolveFetch = resolve;
      }),
    );
    const cache = new ActorTokenCache(CONFIG, fetchImpl);

    const calls = [cache.get(), cache.get()];
    resolveFetch!(jsonResponse(tokenBody()));
    const [first, second] = await Promise.all(calls);

    expect(first).toBe('actor-token');
    expect(second).toBe('actor-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clears a failed refresh so a later call can retry', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ message: 'bad secret' }, false, 401),
      )
      .mockResolvedValueOnce(jsonResponse(tokenBody()));
    const cache = new ActorTokenCache(CONFIG, fetchImpl);

    await expect(cache.get()).rejects.toThrow(PartnerApiError);
    const token = await cache.get();

    expect(token).toBe('actor-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('wraps a network failure as a PartnerApiError', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const cache = new ActorTokenCache(CONFIG, fetchImpl);

    await expect(cache.get()).rejects.toMatchObject({ kind: 'network' });
  });

  it('wraps a malformed response as a PartnerApiError', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    const cache = new ActorTokenCache(CONFIG, fetchImpl);

    await expect(cache.get()).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });
});
