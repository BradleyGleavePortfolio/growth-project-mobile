/**
 * Main-merge seam of #326 (B-326-4 reference tag) with #327 (B-327-6
 * URL-credential scrub), both in src/services/sentry.ts:
 *   - #326: captureError(err, { reference }) sets the Sentry `reference` tag,
 *     so support finds the event from the short form a person quotes;
 *   - #327: beforeSend redacts URL-borne credentials everywhere in the event,
 *     tags included.
 * The merge must keep both: the support reference survives every send pass
 * verbatim, while a credential in any tag or extra is still redacted.
 * Fails on #326 alone (no credential pass) and on main alone (no tag).
 */
const mockInit = jest.fn();
const mockSetTag = jest.fn();
const mockSetExtra = jest.fn();
const mockCapture = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: (...a: unknown[]) => mockInit(...a),
  setUser: jest.fn(),
  wrap: (c: unknown) => c,
  withScope: (fn: (scope: unknown) => void) =>
    fn({
      setTag: (...a: unknown[]) => mockSetTag(...a),
      setExtra: (...a: unknown[]) => mockSetExtra(...a),
    }),
  captureException: (...a: unknown[]) => mockCapture(...a),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '6' }, android: { versionCode: 4 }, extra: {} } },
}));

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjF9.c2lnbmF0dXJlLXZhbHVl';
const LINK = `https://api.example.test/v1/me/data-export/download?token=${JWT}`;
const REFERENCE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

type SentryModule = {
  initSentry: () => void;
  captureError: (err: unknown, context?: Record<string, unknown>) => void;
};

function load(): SentryModule {
  let mod: SentryModule | undefined;
  jest.isolateModules(() => {
    mod = require('../sentry') as SentryModule;
  });
  if (!mod) throw new Error('sentry module did not load');
  mod.initSentry();
  return mod;
}

function beforeSend(): (event: unknown, hint: unknown) => unknown {
  return mockInit.mock.calls[0][0].beforeSend;
}

describe('sentry seam: #326 reference tag survives #327 credential scrub', () => {
  const OLD = process.env.EXPO_PUBLIC_SENTRY_DSN;
  beforeEach(() => {
    jest.resetModules();
    mockInit.mockClear();
    mockSetTag.mockClear();
    mockSetExtra.mockClear();
    mockCapture.mockClear();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD;
  });

  it('captureError still sets the reference tag (and extra) after the merge', () => {
    const { captureError } = load();
    const err = new Error('ai_guide request failed');
    captureError(err, { surface: 'ai_guide', reference: REFERENCE, status: 503 });
    expect(mockSetTag).toHaveBeenCalledWith('reference', REFERENCE);
    expect(mockSetExtra).toHaveBeenCalledWith('reference', REFERENCE);
    expect(mockCapture).toHaveBeenCalledWith(err);
  });

  it('captureError without a string reference sets no reference tag', () => {
    const { captureError } = load();
    captureError(new Error('x'), { surface: 'ai_guide', reference: null });
    captureError(new Error('y'), { surface: 'ai_guide', reference: '' });
    expect(mockSetTag).not.toHaveBeenCalled();
  });

  it('beforeSend keeps the reference tag verbatim and redacts a credential in another tag or extra', () => {
    load();
    const event = {
      tags: { reference: REFERENCE, last_link: LINK, bearer: JWT },
      extra: { reference: REFERENCE, surface: 'ai_guide', note: `retry ${LINK}` },
      exception: { values: [{ type: 'Error', value: 'ai_guide request failed' }] },
      user: { id: 'user-1', email: 'person@example.com' },
    };
    const out = beforeSend()(event, {}) as {
      tags: Record<string, string>;
      extra: Record<string, string>;
      user: Record<string, string>;
    };
    expect(out.tags.reference).toBe(REFERENCE);
    expect(out.extra.reference).toBe(REFERENCE);
    expect(out.extra.surface).toBe('ai_guide');
    const text = JSON.stringify(out);
    expect(text).not.toContain(JWT);
    expect(text).not.toContain('person@example.com');
    expect(out.tags.last_link).toBe('https://api.example.test/v1/me/data-export/download?[redacted]');
    expect(out.tags.bearer).toBe('[redacted]');
    expect(out.user).toEqual({ id: 'user-1' });
  });

  it('a client-generated diagnostic reference (correlation.ts) also survives the scrub', () => {
    const { diagnosticReference } = require('../../utils/correlation') as {
      diagnosticReference: (ref: string | null) => string;
    };
    const ref = diagnosticReference(null);
    load();
    const out = beforeSend()({ tags: { reference: ref } }, {}) as { tags: Record<string, string> };
    expect(out.tags.reference).toBe(ref);
  });
});
