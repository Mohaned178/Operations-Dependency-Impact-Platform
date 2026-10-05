import { AuthSessionSchema, ErrorResponseSchema, type AuthSession } from '@opsgraph/shared';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiFetchOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  schema?: ZodType<T>;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthSession | null> | null = null;
let onAuthFailure: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setOnAuthFailure(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

function doFetch(path: string, options: ApiFetchOptions<unknown>): Promise<Response> {
  const headers = new Headers();
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
  };
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  return fetch(`/api${path}`, init);
}

async function parseResponse<T>(response: Response, schema?: ZodType<T>): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json();

  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, code, message, details);
    }
    throw new ApiError(response.status, 'INTERNAL', 'Unexpected server error');
  }

  return schema ? schema.parse(payload) : (payload as T);
}

async function refreshAccessToken(): Promise<AuthSession | null> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    const parsed = AuthSessionSchema.safeParse(payload);
    if (!parsed.success) {
      return null;
    }
    accessToken = parsed.data.accessToken;
    return parsed.data;
  } catch {
    return null;
  }
}

function singleFlightRefresh(): Promise<AuthSession | null> {
  refreshInFlight ??= refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export function restoreSession(): Promise<AuthSession | null> {
  return singleFlightRefresh();
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions<T> = {}): Promise<T> {
  const response = await doFetch(path, options);

  if (response.status === 401 && !path.startsWith('/auth/')) {
    const refreshedToken = (await singleFlightRefresh())?.accessToken;
    if (refreshedToken) {
      return parseResponse(await doFetch(path, options), options.schema);
    }
    onAuthFailure?.();
  }

  return parseResponse(response, options.schema);
}
