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
const errorBody = (code: string, message = 'msg', reason?: string) => ({
  error: { code, message, requestId: 'req-1', ...(reason ? { reason } : {}) },
});
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

  it('keeps the machine-readable reason of an error', async () => {
    const { client } = setup(() => json(403, errorBody('NOT_STAFF', 'No access', 'support_role_missing')));
    const err = await client.get('/x', Thing).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'NOT_STAFF', reason: 'support_role_missing' });
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
    const { client } = setup(() => new Response('<html>bad gateway</html>', { status: 500 }));
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'INTERNAL', status: 500 });
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

  it('does not refresh again for a 401 that arrives after another request already refreshed', async () => {
    let releaseSlow!: (r: Response) => void;
    const slow = new Promise<Response>((r) => (releaseSlow = r));
    let tokenNow = 'old';
    const refresh = vi.fn(async () => {
      tokenNow = 'new';
    });
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (auth(init) === 'Bearer new') return json(200, { n: 5 });
      return String(url).endsWith('/slow') ? slow : json(401, errorBody('TOKEN_EXPIRED'));
    });
    const client = createApiClient({
      getToken: () => tokenNow,
      refresh,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const slowRequest = client.get('/slow', Thing);
    await client.get('/fast', Thing); // 401, refresh, retry with the new token
    expect(refresh).toHaveBeenCalledTimes(1);
    releaseSlow(json(401, errorBody('TOKEN_EXPIRED'))); // the late 401, sent with 'old'
    await expect(slowRequest).resolves.toEqual({ n: 5 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('retries a POST with the same body and the new token', async () => {
    const { client, fetchMock } = setup((_init, call) =>
      call === 1 ? json(401, errorBody('TOKEN_EXPIRED')) : json(200, { n: 6 }),
    );
    await expect(client.post('/things', { a: 1 }, Thing)).resolves.toEqual({ n: 6 });
    const [first, second] = fetchMock.mock.calls.map((c) => c[1]!);
    expect(first!.method).toBe('POST');
    expect(second!.method).toBe('POST');
    expect(second!.body).toBe('{"a":1}');
    expect(auth(second)).toBe('Bearer new');
  });

  it.each([502, 503, 504])('turns a %i without an error envelope into DISCORD_UNAVAILABLE', async (status) => {
    const { client } = setup(() => new Response('<html>gateway</html>', { status }));
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE', status });
  });

  it('keeps the code of a 503 that carries the error envelope', async () => {
    const { client } = setup(() => json(503, errorBody('DISCORD_UNAVAILABLE', 'Discord is down')));
    await expect(client.get('/me', Thing)).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE', message: 'Discord is down' });
  });

  it('aborts a request after the timeout and reports NETWORK', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const client = createApiClient({
        getToken: () => 't',
        refresh: async () => {},
        fetch: fetchMock as unknown as typeof fetch,
      });
      const result = client.get('/me', Thing).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await result).toMatchObject({ code: 'NETWORK', status: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
