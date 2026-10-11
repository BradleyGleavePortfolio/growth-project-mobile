// B-665-1 (LEGAL-03 / PRIV-06): signing out sends nothing to PostHog, not even
// the feature-flag reload that the SDK's reset() starts. Runs the real
// src/lib/analytics.ts against the installed posthog-react-native SDK; only
// storage (memory) and the network (a fetch stub that records URLs) are fake.
jest.mock('posthog-react-native', () => {
  // The package's exports map hides the class file, so load it by path.
  const { PostHog } = jest.requireActual(
    require('path').join(__dirname, '../../../node_modules/posthog-react-native/dist/posthog-rn.js'),
  );
  return {
    __esModule: true,
    default: jest.fn(
      (key: string, options: object) =>
        new PostHog(key, {
          ...options,
          persistence: 'memory',
          flushInterval: 0,
          fetchRetryCount: 0,
          disableCompression: true, // keep request bodies readable JSON
        }),
    ),
  };
});

type Analytics = typeof import('../analytics');
function freshAnalytics(): Analytics {
  let mod!: Analytics;
  jest.isolateModules(() => {
    mod = require('../analytics');
  });
  return mod;
}

type SentEvent = { event: string; distinct_id: string; properties?: { $anon_distinct_id?: string } };

// Only URLs and bodies are kept (strings), so a failure prints cleanly.
let requests: Array<{ url: string; body: string }> = [];
const originalFetch = global.fetch;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  requests = [];
  global.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    requests.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : '' });
    return {
      status: 200,
      ok: true,
      json: async () => ({ featureFlags: {}, featureFlagPayloads: {} }),
      text: async () => '{}',
    };
  }) as unknown as typeof fetch;
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_test_key';
});

afterEach(async () => {
  await settle();
  global.fetch = originalFetch;
  delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
});

describe('analytics consent against the installed PostHog SDK', () => {
  it('sends nothing on sign-out, then the next account starts with its own identity', async () => {
    const a = freshAnalytics();
    a.identify('account-a');
    a.track('login_completed', { method: 'email' });
    const client = a.getPostHogClient()!;
    await client.ready();
    await client.flush();
    await settle();
    expect(requests.length).toBeGreaterThan(0); // the stub is the SDK's transport
    const anonA = client.getAnonymousId();

    requests = [];
    a.reset(); // what authActions.signOut calls
    a.track('signed_out_screen');
    await settle();
    expect(requests.map((r) => r.url)).toEqual([]);

    a.identify('account-b');
    a.track('login_completed', { method: 'google' });
    await client.flush();
    await settle();
    const events = requests
      .filter((r) => r.url.includes('/batch/'))
      .flatMap((r) => JSON.parse(r.body).batch as SentEvent[]);
    const login = events.find((e) => e.event === 'login_completed');
    expect(login?.distinct_id).toBe('account-b');
    expect(events.some((e) => e.distinct_id === 'account-a')).toBe(false);
    const identifyB = events.find((e) => e.event === '$identify');
    expect(identifyB?.properties?.$anon_distinct_id).not.toBe(anonA);
  });
});
