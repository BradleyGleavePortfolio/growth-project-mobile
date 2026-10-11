// Analytics records only the events the app sends on purpose: no taps, no
// on-screen text, no screen views, no app lifecycle events, no session
// replay. The provider props are read from App.tsx's real AnalyticsProvider
// and then run through the installed SDK's real PostHogProvider.
import path from 'path';
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

type ProviderProps = { apiKey?: string; autocapture?: unknown; options?: Record<string, unknown> };
const mockProviderProps: ProviderProps[] = [];
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: jest.fn(() => ({ capture: jest.fn() })),
  PostHogProvider: (props: ProviderProps & { children: React.ReactNode }) => {
    mockProviderProps.push(props);
    return props.children;
  },
}));
jest.mock('./src/navigation/RootNavigator', () => () => null);
jest.mock('./src/db/database', () => ({ initDatabase: jest.fn() }));
jest.mock('./src/screenshots', () => ({
  isScreenshotMode: () => false,
  installAxiosMockAdapter: jest.fn(),
  seedDemoUser: jest.fn(),
}));

import PostHog from 'posthog-react-native';
import { AnalyticsProvider } from './App';
import { identify, track } from './src/lib/analytics';

// Loaded by path: the package does not export the subpath.
const { PostHogProvider: RealPostHogProvider } = jest.requireActual(
  path.resolve(__dirname, 'node_modules/posthog-react-native/dist/PostHogProvider.js'),
);

async function appProviderProps(): Promise<ProviderProps> {
  mockProviderProps.length = 0;
  await render(<AnalyticsProvider>{null}</AnalyticsProvider>);
  return mockProviderProps[0];
}

/** Tap a health value inside the real SDK provider; return what reached the SDK. */
async function tapWeight({ autocapture, options }: ProviderProps) {
  const client = { autocapture: jest.fn(), screen: jest.fn(), capture: jest.fn(), debug: jest.fn() };
  const r = await render(
    <RealPostHogProvider client={client} autocapture={autocapture} options={options}>
      <Text testID="weight">Weight 82.4 kg</Text>
    </RealPostHogProvider>,
  );
  const weight = r.getByTestId('weight');
  await fireEvent(weight, 'touchEndCapture', {
    _targetInst: (weight as unknown as { unstable_fiber: unknown }).unstable_fiber,
    nativeEvent: { pageX: 10, pageY: 10 },
  });
  return client;
}

describe('analytics capture (App.tsx)', () => {
  it('turns off all SDK autocapture and session replay', async () => {
    const { autocapture, options } = await appProviderProps();
    expect(autocapture).toBe(false);
    expect(options?.enableSessionReplay).toBe(false);
    expect(options?.captureAppLifecycleEvents).toBe(false);
  });

  it('gives the provider no project key, so its client sends nothing before sign-in', async () => {
    const { apiKey } = await appProviderProps();
    expect(apiKey).toBe('');
  });

  it('sends no event and no on-screen text when the user taps', async () => {
    const client = await tapWeight(await appProviderProps());
    expect(client.autocapture).not.toHaveBeenCalled();
    expect(client.screen).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('control: the same tap with autocapture on sends the on-screen text', async () => {
    const client = await tapWeight({ autocapture: true });
    expect(JSON.stringify(client.autocapture.mock.calls)).toContain('Weight 82.4 kg');
  });

  it('still sends explicit events, from a client with no lifecycle events or replay', () => {
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    identify('user-1'); // signed in: analytics may start
    track('app_opened', { cold_start: true });
    expect(PostHog).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ captureAppLifecycleEvents: false, enableSessionReplay: false }),
    );
    const client = jest.mocked(PostHog).mock.results[0].value;
    expect(client.capture).toHaveBeenCalledWith('app_opened', { cold_start: true });
  });
});
