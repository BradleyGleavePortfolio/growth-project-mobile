/**
 * Main merge of #327 (B-327-6) with main's content policy (B-330-3): the
 * Sentry init in src/services/sentry.ts runs BOTH passes on every send path.
 *   1. sentryPrivacy (main): drops console breadcrumbs, route-shapes URLs,
 *      keeps user.id only, strips request bodies, cookies and queries.
 *   2. sentryScrub (#327): redacts URL-borne credentials (download tokens,
 *      JWTs, signed storage URLs) wherever they appear, including exception
 *      text that pass 1 keeps verbatim.
 * Neither pass alone is enough; this pins that the merge kept both.
 */
const mockInit = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: (...a: unknown[]) => mockInit(...a),
  setUser: jest.fn(),
  wrap: (c: unknown) => c,
  withScope: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '6' }, android: { versionCode: 4 }, extra: {} } },
}));

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjF9.c2lnbmF0dXJlLXZhbHVl';
const LINK = `https://api.example.test/v1/me/data-export/download?token=${JWT}`;

function initOptions(): Record<string, (...a: unknown[]) => unknown> {
  jest.isolateModules(() => {
    require('../sentry').initSentry();
  });
  return mockInit.mock.calls[0][0];
}

describe('sentry init composes the content policy and the URL-credential scrub', () => {
  const OLD = process.env.EXPO_PUBLIC_SENTRY_DSN;
  beforeEach(() => {
    jest.resetModules();
    mockInit.mockClear();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD;
  });

  it('beforeSend: exception text quoting a download link loses the token; policy still applies', () => {
    const options = initOptions();
    const event = {
      exception: { values: [{ type: 'Error', value: `Could not open URL '${LINK}'` }] },
      extra: { lastLink: LINK },
      breadcrumbs: [{ category: 'console', message: LINK }],
      user: { id: 'user-1', email: 'person@example.com' },
      request: { url: LINK, query_string: `token=${JWT}` },
    };
    const out = JSON.stringify(options.beforeSend(event, {}));
    expect(out).not.toContain(JWT);
    expect(out).not.toContain('person@example.com');
    expect(out).toContain('Could not open URL');
    expect(out).toContain('user-1');
    const parsed = JSON.parse(out);
    expect(parsed.breadcrumbs).toEqual([]);
    expect(parsed.request.query_string).toBeUndefined();
  });

  it('beforeBreadcrumb: console still dropped; a kept breadcrumb is credential-scrubbed', () => {
    const options = initOptions();
    expect(options.beforeBreadcrumb({ category: 'console', message: LINK }, {})).toBeNull();
    const nav = options.beforeBreadcrumb(
      { category: 'navigation', data: { from: 'Settings', to: JWT } },
      {},
    ) as { data?: Record<string, unknown> };
    expect(JSON.stringify(nav)).not.toContain(JWT);
    const xhr = options.beforeBreadcrumb(
      { category: 'xhr', data: { method: 'GET', url: LINK, status_code: 200 } },
      {},
    ) as { data: { url: string } };
    expect(xhr.data.url).toBe('https://api.example.test/v1/me/data-export/download');
  });

  it('beforeSendTransaction: span text and attributes lose the token', () => {
    const options = initOptions();
    const tx = {
      type: 'transaction',
      spans: [
        {
          span_id: 'a',
          trace_id: 't',
          start_timestamp: 1,
          op: 'http.client',
          description: `GET ${LINK}`,
          data: { 'http.query': `?token=${JWT}`, url: LINK },
        },
      ],
      extra: { note: `retry ${LINK}` },
    };
    expect(JSON.stringify(options.beforeSendTransaction(tx, {}))).not.toContain(JWT);
  });
  it('B-305-12: init removes the SDK ExpoContext integration and keeps every other default', () => {
    const options = initOptions();
    const defaults = [{ name: 'InboundFilters' }, { name: 'ExpoContext' }, { name: 'DeviceContext' }, { name: 'Release' }];
    const kept = options.integrations(defaults) as Array<{ name: string }>;
    expect(kept.map((i) => i.name)).toEqual(['InboundFilters', 'DeviceContext', 'Release']);
  });
});
