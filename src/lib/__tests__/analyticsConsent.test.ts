// LEGAL-03 / PRIV-06: nothing reaches PostHog before a person signs in.
// Signing in (identify) is the consent point; sign-out (reset) withdraws it.
// Runs the real src/lib/analytics.ts against a stub PostHog constructor.

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

import PostHog from 'posthog-react-native';

type Analytics = typeof import('../analytics');
function freshAnalytics(): Analytics {
  let mod!: Analytics;
  jest.isolateModules(() => {
    mod = require('../analytics');
  });
  return mod;
}

beforeEach(() => {
  mockClients.length = 0;
  jest.mocked(PostHog).mockClear();
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'phc_test_key';
});

describe('analytics consent', () => {
  it('builds no client and sends nothing while nobody has signed in', () => {
    const a = freshAnalytics();
    a.track('app_opened', { cold_start: true });
    a.track('signup_completed', { method: 'email' });
    expect(PostHog).not.toHaveBeenCalled();
    expect(a.getPostHogClient()).toBeNull();
  });

  it('after sign-in, identifies first and then sends the events held since launch', () => {
    const a = freshAnalytics();
    a.track('app_opened', { cold_start: true, email: 'a@b.co' });
    a.identify('user-1', { role: 'client' });
    a.track('login_completed', { method: 'email' });

    expect(PostHog).toHaveBeenCalledTimes(1);
    const client = mockClients[0];
    expect(client.identify).toHaveBeenCalledWith('user-1', { role: 'client' });
    expect(client.capture.mock.calls).toEqual([
      ['app_opened', { cold_start: true }], // PII stripped while held
      ['login_completed', { method: 'email' }],
    ]);
    expect(client.identify.mock.invocationCallOrder[0]).toBeLessThan(
      client.capture.mock.invocationCallOrder[0],
    );
  });

  it('holds at most 20 events before sign-in', () => {
    const a = freshAnalytics();
    for (let i = 0; i < 25; i += 1) a.track('screen_step', { i });
    a.identify('user-1');
    expect(mockClients[0].capture).toHaveBeenCalledTimes(20);
  });

  it('after sign-out, sends nothing until the next sign-in', () => {
    const a = freshAnalytics();
    a.identify('user-1');
    const client = mockClients[0];
    expect(client.reset).toHaveBeenCalledTimes(1); // fresh SDK identity at sign-in
    a.identify('user-1'); // same session (cold start + sign-in screen): no reset
    a.reset();
    expect(client.reset).toHaveBeenCalledTimes(1); // sign-out itself touches no SDK call
    a.track('after_sign_out');
    a.identify('user-2');

    expect(client.reset).toHaveBeenCalledTimes(2);
    expect(client.reset.mock.invocationCallOrder[1]).toBeLessThan(
      client.identify.mock.invocationCallOrder[2],
    );
    expect(client.capture).not.toHaveBeenCalledWith('after_sign_out', expect.anything());
    expect(client.identify).toHaveBeenLastCalledWith('user-2', {});
  });

  it('drops events held before a sign-out that happens without a sign-in', () => {
    const a = freshAnalytics();
    a.track('app_opened');
    a.reset();
    a.identify('user-1');
    expect(mockClients[0].capture).not.toHaveBeenCalled();
  });

  it('accepts the legacy key name', () => {
    delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_legacy';
    const a = freshAnalytics();
    a.identify('user-1');
    expect(PostHog).toHaveBeenCalledWith('phc_legacy', expect.any(Object));
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  });
});
