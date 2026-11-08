/** Tiny typed fetch wrapper for the FastAPI JSON API. */

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  query?: Query;
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const text = params.toString();
  if (!text) return path;
  return path + (path.includes('?') ? '&' : '?') + text;
}

/** FastAPI errors carry `{detail: string | [{msg, ...}]}`. */
function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const { detail } = body as { detail: unknown };
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) =>
          item && typeof item === 'object' && 'msg' in item ? String(item.msg) : null,
        )
        .filter((msg): msg is string => msg !== null);
      if (messages.length > 0) return messages.join('; ');
    }
  }
  return fallback;
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  { query, headers, ...init }: RequestOptions = {},
): Promise<T> {
  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  const response = await fetch(withQuery(path, query), {
    cache: 'no-store',
    ...init,
    method,
    headers: finalHeaders,
    body: payload,
  });
  const text = await response.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      detailOf(parsed, response.statusText || `HTTP ${response.status}`),
    );
  }
  return parsed as T;
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>(method, path, body, options);
}
