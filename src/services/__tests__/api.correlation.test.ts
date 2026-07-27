/**
 * Outbound correlation header (M5-D).
 *
 * Before this, a coach's failed import produced no shared identifier between
 * what they saw and any backend log line, so support could only ask them to try
 * again. These tests pin the request interceptor's contract: every request
 * leaves with a fresh, opaque `X-Request-Id`, an explicitly supplied id is
 * respected, and the header never displaces the Authorization header.
 *
 * Strategy mirrors api.refresh.test.ts — axios.create() is mocked so the
 * interceptor api.ts registers can be invoked directly with a bare config.
 */
import type { InternalAxiosRequestConfig } from 'axios';

type RequestHandler = (
  config: InternalAxiosRequestConfig,
) => Promise<InternalAxiosRequestConfig>;

jest.mock('axios', () => {
  const instance = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), handlers: [] as RequestHandler[] },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} as Record<string, string> } },
  };
  instance.interceptors.request.use.mockImplementation((fulfilled: RequestHandler) => {
    instance.interceptors.request.handlers.push(fulfilled);
  });
  return {
    __esModule: true,
    default: { create: jest.fn(() => instance) },
    __instance: instance,
  };
});

jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => (k === 'supabase_token' ? 'jwt-token' : null)),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const axiosMock = jest.requireMock('axios') as {
  __instance: { interceptors: { request: { handlers: RequestHandler[] } } };
};

import '../api';
import { REQUEST_ID_HEADER } from '../../utils/correlation';

function requestInterceptor(): RequestHandler {
  const handler = axiosMock.__instance.interceptors.request.handlers[0];
  if (!handler) throw new Error('Request interceptor not registered');
  return handler;
}

function config(headers: Record<string, string> = {}): InternalAxiosRequestConfig {
  return { url: '/extension/pair/init', headers } as unknown as InternalAxiosRequestConfig;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('api request interceptor — support correlation', () => {
  it('attaches an X-Request-Id to every request', async () => {
    const out = await requestInterceptor()(config());
    expect(String(out.headers[REQUEST_ID_HEADER])).toMatch(UUID_V4);
  });

  it('issues a distinct id per request, so ids are not a device fingerprint', async () => {
    const a = await requestInterceptor()(config());
    const b = await requestInterceptor()(config());
    expect(a.headers[REQUEST_ID_HEADER]).not.toBe(b.headers[REQUEST_ID_HEADER]);
  });

  it('keeps an id a caller set deliberately', async () => {
    const out = await requestInterceptor()(config({ [REQUEST_ID_HEADER]: 'caller-supplied' }));
    expect(out.headers[REQUEST_ID_HEADER]).toBe('caller-supplied');
  });

  it('still attaches the bearer token alongside it', async () => {
    const out = await requestInterceptor()(config());
    expect(out.headers.Authorization).toBe('Bearer jwt-token');
    expect(String(out.headers[REQUEST_ID_HEADER])).toMatch(UUID_V4);
  });

  it('carries no user, token, or path data in the id itself', async () => {
    const out = await requestInterceptor()(config());
    const id = String(out.headers[REQUEST_ID_HEADER]);
    expect(id).not.toContain('jwt-token');
    expect(id).not.toContain('extension');
    expect(id).not.toMatch(/[^0-9a-f-]/);
  });
});
