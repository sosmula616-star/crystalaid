import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client.js';

// A minimal schema: the client only needs `parse`, which zod schemas provide.
const Thing = {
  parse(data: unknown): { n: number } {
    if (typeof data === 'object' && data !== null && typeof (data as { n?: unknown }).n === 'number') {
      return data as { n: number };
    }
    throw new Error('not a thing');
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const errorBody = (code: string, message = 'msg') => ({ error: { code, message, requestId: 'req-1' } });
const auth = (init: RequestInit | undefined) => (init?.headers as Record<string, string>).authorization;

function setup(handler: (init: RequestInit, call: number) => Response | Promise<Response>) {
  let token: string | null = 'old';
  let calls = 0;
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    handler(init ?? {}, ++calls),
  );
  const refresh = vi.fn(async () => {
    await Promise.resolve();
    token = 'new';
  });
  const client = createApiClient({
    getToken: () => token,
    refresh,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock, refresh };
}

describe('api client', () => {
  it('sends the bearer token to the /api base path and parses the body', async () => {
    const { client, fetchMock } = setup(() => json(200, { n: 1 }));
    await expect(client.get('/me', Thing)).resolves.toEqual({ n: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/me');
    expect(auth(init)).toBe('Bearer old');
  });

  it('sends JSON bodies for post and patch', async () => {
    const { client, fetchMock } = setup(() => json(200, { n: 2 }));
    await client.post('/x', { a: 1 }, Thing);
    await client.patch('/x', { b: 2 }, Thing);
    const post = fetchMock.mock.calls[0]![1]!;
    const patch = fetchMock.mock.calls[1]![1]!;
    expect(post.method).toBe('POST');
    expect(post.body).toBe('{"a":1}');
    expect((post.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(patch.method).toBe('PATCH');
    expect(patch.body).toBe('{"b":2}');
  });

  it('turns an API error into ApiError with its code, status and request id', async () => {
    const { client } = setup(() => json(403, errorBody('NOT_STAFF', 'No access')));
    const err = await client.get('/me', Thing).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'NOT_STAFF', status: 403, message: 'No access', requestId: 'req-1' });
  });

  it('turns a response that does not match the schema into INTERNAL', async () => {
    const { client } = setup(() => json(200, { n: 'text' }));
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'INTERNAL', status: 200 });
  });

  it('turns an error body of the wrong shape into INTERNAL', async () => {
    const { client } = setup(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('turns a failed fetch into NETWORK', async () => {
    const { client } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('retries once after refresh on 401 TOKEN_EXPIRED, with the new token', async () => {
    const { client, fetchMock, refresh } = setup((_init, call) =>
      call === 1 ? json(401, errorBody('TOKEN_EXPIRED')) : json(200, { n: 3 }),
    );
    await expect(client.get('/me', Thing)).resolves.toEqual({ n: 3 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth(fetchMock.mock.calls[1]![1])).toBe('Bearer new');
  });

  it('throws when the retry is refused again, without a second refresh', async () => {
    const { client, refresh, fetchMock } = setup(() => json(401, errorBody('TOKEN_EXPIRED')));
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws the refresh error when refresh fails', async () => {
    const fetchMock = vi.fn(async () => json(401, errorBody('TOKEN_EXPIRED')));
    const failure = new ApiError('NOT_STAFF', 'gone', 403);
    const client = createApiClient({
      getToken: () => 'old',
      refresh: async () => {
        throw failure;
      },
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.get('/me', Thing)).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on other 401 codes', async () => {
    const { client, refresh } = setup(() => json(401, errorBody('UNAUTHORIZED')));
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shares one refresh between 5 parallel expired requests and all succeed', async () => {
    const { client, refresh } = setup((init) =>
      auth(init) === 'Bearer old' ? json(401, errorBody('TOKEN_EXPIRED')) : json(200, { n: 4 }),
    );
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => client.get(`/r${i}`, Thing)));
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ n: 4 })));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
