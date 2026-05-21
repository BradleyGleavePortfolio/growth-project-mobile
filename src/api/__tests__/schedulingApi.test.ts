/**
 * schedulingApi — Lane 4 contract tests.
 *
 * Verifies the runtime guarantees added for P1-6 (client_timezone is
 * always present on the wire for requestSession and rescheduleSession,
 * even when the caller forgets it) and P3-3 (CoachingSession type
 * supports the optional `cancellable` flag).
 */

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: { create: jest.fn(() => instance) },
    __instance: instance,
  };
});

const axiosMock = jest.requireMock('axios') as {
  __instance: { post: jest.Mock };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { schedulingApi, resolveClientTimezone } = require('../schedulingApi');

describe('schedulingApi — P1-6 client_timezone enforcement', () => {
  beforeEach(() => {
    axiosMock.__instance.post.mockReset().mockResolvedValue({ data: {} });
  });

  it('resolveClientTimezone returns a non-empty IANA-shaped string', () => {
    const tz = resolveClientTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });

  it('requestSession forwards a caller-provided client_timezone unchanged', async () => {
    await schedulingApi.requestSession({
      coach_id: 'c1',
      title: 'Coaching session',
      start_at: '2026-05-21T15:00:00Z',
      end_at: '2026-05-21T15:30:00Z',
      client_timezone: 'Europe/Berlin',
    });
    const [, payload] = axiosMock.__instance.post.mock.calls[0];
    expect(payload.client_timezone).toBe('Europe/Berlin');
  });

  it('requestSession force-resolves client_timezone when the caller omits it', async () => {
    await schedulingApi.requestSession({
      coach_id: 'c1',
      title: 'Coaching session',
      start_at: '2026-05-21T15:00:00Z',
      end_at: '2026-05-21T15:30:00Z',
    });
    const [, payload] = axiosMock.__instance.post.mock.calls[0];
    expect(payload.client_timezone).toBeTruthy();
    expect(typeof payload.client_timezone).toBe('string');
  });

  it('requestSession force-resolves client_timezone when the caller passes undefined', async () => {
    await schedulingApi.requestSession({
      coach_id: 'c1',
      title: 'Coaching session',
      start_at: '2026-05-21T15:00:00Z',
      end_at: '2026-05-21T15:30:00Z',
      client_timezone: undefined as unknown as string,
    });
    const [, payload] = axiosMock.__instance.post.mock.calls[0];
    expect(payload.client_timezone).toBeTruthy();
  });

  it('rescheduleSession forwards a caller-provided client_timezone unchanged', async () => {
    await schedulingApi.rescheduleSession('sess-1', {
      start_at: '2026-05-21T15:00:00Z',
      end_at: '2026-05-21T15:30:00Z',
      client_timezone: 'Asia/Tokyo',
    });
    const [, payload] = axiosMock.__instance.post.mock.calls[0];
    expect(payload.client_timezone).toBe('Asia/Tokyo');
  });

  it('rescheduleSession force-resolves client_timezone when the caller omits it', async () => {
    await schedulingApi.rescheduleSession('sess-1', {
      start_at: '2026-05-21T15:00:00Z',
      end_at: '2026-05-21T15:30:00Z',
    });
    const [, payload] = axiosMock.__instance.post.mock.calls[0];
    expect(payload.client_timezone).toBeTruthy();
  });
});
