/** Anything with `parse`, such as a zod schema from @crystalaid/contracts. */
export interface ResponseSchema<T> {
  parse(data: unknown): T;
}

/**
 * Server error codes plus `NETWORK`, which exists only on the client:
 * the request never produced an HTTP response.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(code: string, message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (requestId !== undefined) this.requestId = requestId;
  }
}

export interface ApiClient {
  get<T>(path: string, schema: ResponseSchema<T>): Promise<T>;
  post<T>(path: string, body: unknown, schema: ResponseSchema<T>): Promise<T>;
  patch<T>(path: string, body: unknown, schema: ResponseSchema<T>): Promise<T>;
}

export interface ApiClientDeps {
  getToken(): string | null;
  /** Signs in again and stores a fresh token. Called after a 401 TOKEN_EXPIRED. */
  refresh(): Promise<void>;
  fetch?: typeof fetch;
  /** Defaults to `/api`: Discord URL Mapping and the Vite dev proxy strip it. */
  baseUrl?: string;
}

interface ErrorEnvelope {
  code: string;
  message: string;
  requestId?: string;
}

function readEnvelope(body: unknown): ErrorEnvelope | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message, requestId } = error as Record<string, unknown>;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return typeof requestId === 'string' ? { code, message, requestId } : { code, message };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const baseUrl = deps.baseUrl ?? '/api';
  const doFetch = (...args: Parameters<typeof fetch>) => (deps.fetch ?? fetch)(...args);
  let refreshing: Promise<void> | null = null;

  /** All requests that expire together wait for one sign-in. */
  const refreshOnce = (): Promise<void> => {
    refreshing ??= deps.refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  async function attempt<T>(
    method: string,
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
  ): Promise<{ token: string | null; result: T }> {
    const token = deps.getToken();
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch (cause) {
      throw new ApiError('NETWORK', cause instanceof Error ? cause.message : 'Network error', 0);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const envelope = readEnvelope(payload);
      if (!envelope) throw new ApiError('INTERNAL', `Unexpected response (${response.status})`, response.status);
      throw new ApiError(envelope.code, envelope.message, response.status, envelope.requestId);
    }
    try {
      return { token, result: schema.parse(payload) };
    } catch {
      throw new ApiError('INTERNAL', 'Response does not match the expected shape', response.status);
    }
  }

  async function request<T>(method: string, path: string, body: unknown, schema: ResponseSchema<T>): Promise<T> {
    const usedToken = deps.getToken();
    try {
      return (await attempt(method, path, body, schema)).result;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || error.code !== 'TOKEN_EXPIRED') throw error;
      // A request that failed with the old token while another one already refreshed
      // only needs the retry, not a second sign-in.
      if (deps.getToken() === usedToken) await refreshOnce();
      return (await attempt(method, path, body, schema)).result;
    }
  }

  return {
    get: (path, schema) => request('GET', path, undefined, schema),
    post: (path, body, schema) => request('POST', path, body, schema),
    patch: (path, body, schema) => request('PATCH', path, body, schema),
  };
}
