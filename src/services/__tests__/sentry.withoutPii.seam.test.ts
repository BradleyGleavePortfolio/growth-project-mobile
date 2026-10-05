/**
 * Main-merge seam of #315 (captureErrorWithoutPii, OR-112-15) with #327
 * (B-327-6 URL-credential scrub) in src/services/sentry.ts. A Trust & Privacy
 * link-failure report runs the scope processor (stripPersonalData) and then
 * the init's beforeSend (content policy + credential scrub). The merge must
 * keep both: no user, request or breadcrumbs; no credential anywhere; the
 * support reference kept verbatim as a searchable tag and extra.
 */
type Processor = (event: Record<string, unknown>) => Record<string, unknown>;

const mockScope = {
  extras: {} as Record<string, unknown>,
  tags: {} as Record<string, string>,
  processors: [] as Processor[],
  setExtra(k: string, v: unknown) {
    this.extras[k] = v;
  },
  setTag(k: string, v: string) {
    this.tags[k] = v;
  },
  addEventProcessor(fn: Processor) {
    this.processors.push(fn);
  },
};
const mockCaptureException = jest.fn();
const mockInit = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: (...a: unknown[]) => mockInit(...a),
  wrap: (c: unknown) => c,
  withScope: (fn: (s: typeof mockScope) => void) => fn(mockScope),
  captureException: (...a: unknown[]) => mockCaptureException(...a),
  setUser: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '6' }, android: { versionCode: 4 }, extra: {} } },
}));

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjF9.c2lnbmF0dXJlLXZhbHVl';
const LINK = `https://api.example.test/v1/me/data-export/download?token=${JWT}`;

describe('sentry seam: #315 report without personal data still passes the #327 credential scrub', () => {
  const OLD = process.env.EXPO_PUBLIC_SENTRY_DSN;
  beforeEach(() => {
    jest.resetModules();
    mockScope.extras = {};
    mockScope.tags = {};
    mockScope.processors = [];
    mockCaptureException.mockReset();
    mockInit.mockReset();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD;
  });

  it('scope processor, then beforeSend: no user/request/breadcrumbs, no credential, reference kept', () => {
    const sentry = require('../sentry');
    sentry.initSentry();
    const beforeSend = mockInit.mock.calls[0][0].beforeSend as (e: unknown, h: unknown) => Record<string, unknown>;
    sentry.captureErrorWithoutPii(new Error('trust_center link failed'), {
      event: 'trust_center.link_failure',
      link: 'privacy_policy',
      reference: 'ab12cd34',
    });
    expect(mockScope.processors).toHaveLength(1);

    const raw = {
      exception: { values: [{ type: 'Error', value: `Could not open URL '${LINK}'` }] },
      user: { id: 'acct-1', email: 'person@mail.invalid' },
      request: { url: LINK },
      breadcrumbs: [{ category: 'navigation', data: { to: LINK } }],
      tags: { ...mockScope.tags, stray: JWT },
      extra: { ...mockScope.extras, note: `retry ${LINK}` },
    };
    const out = beforeSend(mockScope.processors[0](raw), {}) as {
      tags: Record<string, string>;
      extra: Record<string, string>;
    };
    expect(out).not.toHaveProperty('user');
    expect(out).not.toHaveProperty('request');
    expect(out).not.toHaveProperty('breadcrumbs');
    const text = JSON.stringify(out);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain('person@mail.invalid');
    expect(text).not.toContain('acct-1');
    expect(text).toContain('Could not open URL');
    expect(out.tags.reference).toBe('ab12cd34');
    expect(out.tags.stray).toBe('[redacted]');
    expect(out.extra.reference).toBe('ab12cd34');
    expect(out.extra.link).toBe('privacy_policy');
  });

  it('no reference tag when the context has none', () => {
    const sentry = require('../sentry');
    sentry.initSentry();
    sentry.captureErrorWithoutPii(new Error('x'), { event: 'trust_center.link_failure' });
    expect(mockScope.tags).toEqual({});
  });
});
