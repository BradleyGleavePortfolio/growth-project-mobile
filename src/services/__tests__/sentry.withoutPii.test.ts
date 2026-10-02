/**
 * captureErrorWithoutPii (OR-112-15): a report that must not identify the
 * person is sent without the signed-in user (id, email), request data or
 * breadcrumbs, even though setSentryUser tags every event app-wide.
 */
type Processor = (event: Record<string, unknown>) => Record<string, unknown>;

const mockScope = {
  extras: {} as Record<string, unknown>,
  processors: [] as Processor[],
  setExtra(k: string, v: unknown) {
    this.extras[k] = v;
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

describe('captureErrorWithoutPii', () => {
  beforeEach(() => {
    jest.resetModules();
    mockScope.extras = {};
    mockScope.processors = [];
    mockCaptureException.mockReset();
    mockInit.mockReset();
  });

  it('is a no-op before Sentry is initialised', () => {
    const { captureErrorWithoutPii } = require('../sentry');
    captureErrorWithoutPii(new Error('x'), { where: 'w' });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('sends the error with the given extras and a processor that drops user, request and breadcrumbs', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@sentry.invalid/1';
    try {
      const sentry = require('../sentry');
      sentry.initSentry();
      expect(mockInit).toHaveBeenCalledTimes(1);
      const err = new Error('link failed');
      sentry.captureErrorWithoutPii(err, { where: 'trust_center.link_open', reference: 'ab12cd34' });

      expect(mockCaptureException).toHaveBeenCalledWith(err);
      expect(mockScope.extras).toEqual({ where: 'trust_center.link_open', reference: 'ab12cd34' });
      expect(mockScope.processors).toHaveLength(1);

      const event = {
        message: 'm',
        user: { id: 'u1', email: 'person@mail.invalid' },
        request: { url: 'https://x.invalid/p?q=1' },
        breadcrumbs: [{ data: { url: 'https://x.invalid/api?token=t' } }],
        contexts: { os: { name: 'iOS' } },
        extra: { where: 'trust_center.link_open' },
      };
      const out = mockScope.processors[0](event);
      expect(out).toEqual({
        message: 'm',
        contexts: { os: { name: 'iOS' } },
        extra: { where: 'trust_center.link_open' },
      });
    } finally {
      delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    }
  });

  it('stripPersonalData leaves an event without personal data unchanged', () => {
    const { stripPersonalData } = require('../sentry');
    expect(stripPersonalData({ message: 'm', tags: { a: 'b' } })).toEqual({ message: 'm', tags: { a: 'b' } });
  });
});
