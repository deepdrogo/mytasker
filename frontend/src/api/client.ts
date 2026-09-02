// MyTasker — HTTP client.
// Built by drogoz · https://github.com/deepdrogo/mytasker

/**
 * Central API client. Every request in the app goes through here - no bare fetch() in components.
 * Handles: base URL, credentials, CSRF, client-source header, error normalisation, 401 handling.
 */

export const API_BASE = '/api/v1';

export type ApiErrorCode =
  | 'validation_error'
  | 'not_authenticated'
  | 'authentication_failed'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'external_service_error'
  | 'server_error'
  | 'network_error'
  | 'domain_error'
  | string;

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  fields: Record<string, string[] | string>;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: Record<string, string[] | string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? {};
  }

  fieldError(name: string): string | undefined {
    const value = this.fields[name];
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.code === 'validation_error';
  }
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface CursorPage<T> {
  next: string | null;
  previous: string | null;
  results: T[];
}

type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type QueryParams = Record<string, QueryValue>;

interface RequestOptions {
  params?: QueryParams;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  raw?: boolean;
}

let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match?.[2] ? decodeURIComponent(match[2]) : '';
}

function clientSource(): string {
  const isMobile =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768);
  return isMobile ? 'mobile_web' : 'web';
}

export function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return await response.text();
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith('http') || path.startsWith('/api') ? path : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Client-Source': clientSource(),
    ...options.headers,
  };

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('mt_csrf');
    if (csrf) headers['X-CSRFToken'] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(`${url}${buildQuery(options.params)}`, {
      method,
      headers,
      body: payload,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, {
      code: 'network_error',
      message: 'Connection failed. Check your network.',
      fields: {},
    });
  }

  if (response.ok) {
    if (options.raw) return response as unknown as T;
    return (await parseBody(response)) as T;
  }

  const parsed = (await parseBody(response)) as { error?: ApiErrorBody } | null;
  const errorBody: ApiErrorBody = parsed?.error ?? {
    code: response.status === 404 ? 'not_found' : 'server_error',
    message: response.statusText || 'Request failed',
    fields: {},
  };

  if (response.status === 401) unauthorizedHandler?.();

  throw new ApiError(response.status, errorBody);
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
};

/** Ensures the CSRF cookie exists before the first mutation (e.g. login). */
export async function ensureCsrf(): Promise<void> {
  if (readCookie('mt_csrf')) return;
  await api.get('/auth/csrf/').catch(() => undefined);
}
