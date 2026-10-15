// M1b: the app's own install, update and backgrounded events go through the
// consent gate (src/lib/analytics.ts, run for real against a stub PostHog)
// and carry only the app version and build, never a link or token.

type Client = { capture: jest.Mock; identify: jest.Mock; reset: jest.Mock };
const mockClients: Client[] = [];
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: jest.fn(() => {
    const client = { capture: jest.fn(), identify: jest.fn(), reset: jest.fn() };
    mockClients.push(client);
    return client;
  }),
}));
const mockApp = { nativeApplicationVersion: '1.4.0', nativeBuildVersion: '21' };
jest.mock('expo-application', () => mockApp);

type Mods = {
  analytics: typeof import('../../lib/analytics');
  events: typeof import('../appLifecycleEvents');
  storage: typeof import('@react-native-async-storage/async-storage').default;
};
function fresh(): Mods {
  let mods!: Mods;
  jest.isolateModules(() => {
    mods = {
      analytics: require('../../lib/analytics'),
      events: require('../appLifecycleEvents'),
      storage: require('@react-native-async-storage/async-storage').default,
    };
  });
  return mods;
}

function sent(): Array<[string, Record<string, unknown>]> {
  return mockClients.flatMap((c) => c.capture.mock.calls as Array<[string, Record<string, unknown>]>);
}

function fakeAppState() {
  let listener: ((s: string) => void) | null = null;
  return {
    addEventListener: jest.fn((_e: string, l: (s: string) => void) => {
      listener = l;
      return { remove: () => (listener = null) };
    }),
    emit: (s: string) => listener?.(s),
  };
}

beforeEach(() => {
  mockClients.length = 0;
  mockApp.nativeApplicationVersion = '1.4.0';
  mockApp.nativeBuildVersion = '21';
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_test_key';
});

// Every event in every test: only version and build, never a link or token.
afterEach(() => {
  const allowed = ['app_version', 'build', 'previous_version', 'previous_build'];
  for (const [, props] of sent()) {
    expect(Object.keys(props).filter((k) => !allowed.includes(k))).toEqual([]);
    expect(JSON.stringify(props)).not.toMatch(/:\/\/|https?|token|url|link|\?/i);
  }
});

describe('app lifecycle events (M1b)', () => {
  it('sends nothing before sign-in; the install event goes out only after it', async () => {
    const { analytics, events, storage } = fresh();
    await storage.clear();
    await events.trackInstallOrUpdate();
    const appState = fakeAppState();
    events.installBackgroundedEvent(appState as never);
    appState.emit('background');
    expect(mockClients).toHaveLength(0);

    analytics.identify('user-1');
    expect(sent().map(([e]) => e)).toEqual(['app_installed', 'app_backgrounded']);
  });

  it('sends app_installed once, then nothing on the next launch of the same version', async () => {
    const { analytics, events, storage } = fresh();
    await storage.clear();
    analytics.identify('user-1');
    await events.trackInstallOrUpdate();
    await events.trackInstallOrUpdate();
    expect(sent()).toEqual([['app_installed', { app_version: '1.4.0', build: '21' }]]);
    expect(await storage.getItem(events.LAST_APP_VERSION_KEY)).toBe('1.4.0|21');
  });

  it('sends app_updated with the previous and new version and build', async () => {
    const { analytics, events, storage } = fresh();
    await storage.clear();
    await storage.setItem(events.LAST_APP_VERSION_KEY, '1.3.2|19');
    analytics.identify('user-1');
    await events.trackInstallOrUpdate();
    expect(sent()).toEqual([
      [
        'app_updated',
        { app_version: '1.4.0', build: '21', previous_version: '1.3.2', previous_build: '19' },
      ],
    ]);
    expect(await storage.getItem(events.LAST_APP_VERSION_KEY)).toBe('1.4.0|21');
  });

  it('sends app_backgrounded when the app goes to the background, not on inactive or active', () => {
    const { analytics, events } = fresh();
    analytics.identify('user-1');
    const appState = fakeAppState();
    const stop = events.installBackgroundedEvent(appState as never);
    appState.emit('inactive');
    appState.emit('background');
    appState.emit('active');
    stop();
    appState.emit('background');
    expect(sent()).toEqual([['app_backgrounded', { app_version: '1.4.0', build: '21' }]]);
  });
});
