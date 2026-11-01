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
  /** Machine-readable detail from the server (`support_role_missing`, ...); the UI maps it to its own text. */
  readonly reason?: string;

  constructor(code: string, message: string, status: number, requestId?: string, reason?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (requestId !== undefined) this.requestId = requestId;
    if (reason !== undefined) this.reason = reason;
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
  /** A request that takes longer is aborted and reported as NETWORK. Default 15 s. */
  timeoutMs?: number;
}

interface ErrorEnvelope {
  code: string;
  message: string;
  requestId?: string;
  reason?: string;
}

function readEnvelope(body: unknown): ErrorEnvelope | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message, requestId, reason } = error as Record<string, unknown>;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return {
    code,
    message,
    ...(typeof requestId === 'string' ? { requestId } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}

const GATEWAY_STATUSES = new Set([502, 503, 504]);

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    // A body that is not JSON is data (handled by the caller); a timeout is not.
    if (signal.aborted) throw cause;
    return undefined;
  }
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const baseUrl = deps.baseUrl ?? '/api';
  const timeoutMs = deps.timeoutMs ?? 15_000;
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
  ): Promise<T> {
    const token = deps.getToken();
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    init.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let payload: unknown;
    try {
      response = await doFetch(`${baseUrl}${path}`, init);
      payload = await readJson(response, controller.signal);
    } catch (cause) {
      throw new ApiError('NETWORK', cause instanceof Error ? cause.message : 'Network error', 0);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const envelope = readEnvelope(payload);
      if (envelope) throw new ApiError(envelope.code, envelope.message, response.status, envelope.requestId, envelope.reason);
      // A gateway in front of the API answered instead of it: treat that as an outage.
      const code = GATEWAY_STATUSES.has(response.status) ? 'DISCORD_UNAVAILABLE' : 'INTERNAL';
      throw new ApiError(code, `Unexpected response (${response.status})`, response.status);
    }
    try {
      return schema.parse(payload);
    } catch {
      throw new ApiError('INTERNAL', 'Response does not match the expected shape', response.status);
    }
  }

  async function request<T>(method: string, path: string, body: unknown, schema: ResponseSchema<T>): Promise<T> {
    const usedToken = deps.getToken();
    try {
      return await attempt(method, path, body, schema);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || error.code !== 'TOKEN_EXPIRED') throw error;
      // A request that failed with the old token while another one already refreshed
      // only needs the retry, not a second sign-in.
      if (deps.getToken() === usedToken) await refreshOnce();
      return await attempt(method, path, body, schema);
    }
  }

  return {
    get: (path, schema) => request('GET', path, undefined, schema),
    post: (path, body, schema) => request('POST', path, body, schema),
    patch: (path, body, schema) => request('PATCH', path, body, schema),
  };
}
