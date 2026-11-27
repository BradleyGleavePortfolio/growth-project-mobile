/**
 * STORE-CAPTURE-ROUTES-M: every App Store frame's screen reads only routes the screenshot mock answers.
 *
 * scripts/capture-screenshots-web.js fails a frame on any "[screenshot mock] no route" line, so a read the
 * mock lacks (03-workout's GET /exercises/<id> since FIX-928-BW) turns the "Real app store frames" check red.
 * Here each frame in SCREENSHOT_TARGETS opens as the capture opens it: the real ScreenshotNavigator reads
 * tgp://screenshot/<slug>, seeds the demo user (and the workout), and mounts the shipping ClientNavigator or
 * CoachNavigator with the store profile's flags (eas.json production env, as the capture uses). The real
 * services/api instance answers from the real mock adapter. Only the leaf screens no frame opens are shallow
 * (their imports pull native video and camera modules); every frame's own screen, the tab bar, the providers
 * and their hooks run for real, so each read they make reaches the mock.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Linking, Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

// The store build's public env, the way the capture driver builds it (profileEnv in capture-screenshots-web.js).
// Set before any app module loads, so featureFlags resolves as it does in the capture.
function profileEnv(name: string): Record<string, string> {
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../eas.json'), 'utf8')).build[name];
  return { ...(profile.extends ? profileEnv(profile.extends) : {}), ...profile.env };
}
const STORE_ENV = profileEnv('production');
const prevEnv = { ...process.env };
Object.assign(process.env, STORE_ENV, { EXPO_PUBLIC_SCREENSHOT_MODE: '1' });

// The SDK starts a cleanup interval when it loads, which keeps Jest from exiting; no DSN is set, so nothing reports.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(), wrap: <T,>(c: T): T => c, setUser: jest.fn(), captureException: jest.fn(), captureMessage: jest.fn(),
  setTag: jest.fn(), setTags: jest.fn(), setContext: jest.fn(), addBreadcrumb: jest.fn(),
  withScope: (fn: (scope: Record<string, jest.Mock>) => void) => fn({ setExtra: jest.fn(), setTag: jest.fn(), setContext: jest.fn(), setLevel: jest.fn() }),
}));
// The capture's Metro build swaps these two for the capture-only realtime stub (metro.config.js); so does this test.
jest.mock('../../services/realtime', () => require('../realtimeStub'));
jest.mock('../../api/communityRealtime', () => require('../realtimeStub'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// LogScreen's photo helper reads this enum at import; the picker is never opened in a frame.
jest.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
  requestCameraPermissionsAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn(),
}), { virtual: true });

/** Each frame's own screen module, as the navigators import it (relative to src/navigation). */
const FRAME_SCREENS: Record<string, string> = {
  '01-home': '../screens/client/HomeScreen',
  '02-roman': '../screens/roman/RomanChatScreen',
  '03-workout': '../screens/client/ActiveWorkoutScreen',
  '04-food': '../screens/client/LogScreen',
  '05-messages': '../screens/client/MessagesScreen',
  '06-coach-overview': '../screens/coach/command-center/CommandCenterScreen',
};
// The coach navigator renders inside this host (it lays its overlay over every coach tab), so it is real too.
const KEEP = new Set([...Object.values(FRAME_SCREENS), '../screens/coach/ed/FirstPaymentWowHost']);

// Shallow every other leaf screen and sub-navigator the two navigators import; keep the routers and the
// frames' screens real (the pattern of navigation/__tests__/clientTabLabels.test.tsx).
const shallow: string[] = [];
for (const nav of ['ClientNavigator.tsx', 'CoachNavigator.tsx']) {
  const source = fs.readFileSync(path.join(__dirname, '../../navigation', nav), 'utf8');
  for (const m of source.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+|\.\/[A-Za-z]*Navigator)'/gm)) {
    const modulePath = m[1];
    if (KEEP.has(modulePath) || shallow.includes(modulePath)) continue;
    shallow.push(modulePath);
    const fromHere = modulePath.startsWith('./') ? `../../navigation/${modulePath.slice(2)}` : `../${modulePath}`;
    jest.doMock(fromHere, () => ({ __esModule: true, default: function Shallow() { return <Text>{modulePath}</Text>; } }));
  }
}

const MISS = '[screenshot mock] no route'; // mockAdapter.ts's loud miss
const warnings: string[] = [];
const errors: string[] = [];
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
beforeAll(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(' ')); });
  errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')); });
  require('../mockAdapter').installAxiosMockAdapter();
});
afterAll(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  for (const key of Object.keys(process.env)) if (!(key in prevEnv)) delete process.env[key];
  Object.assign(process.env, prevEnv);
});

/** Holds what the frame threw, so a failure names it instead of a missing text. */
class Catch extends React.Component<{ children: React.ReactNode; onError: (e: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { this.props.onError(e); }
  render() { return this.state.failed ? null : this.props.children; }
}

// App.tsx's own query client (its retry and cache rules), which the EntitlementProvider also reads directly.
const { queryClient, settleAndClearQueryCache } = require('../../services/queryClient') as typeof import('../../services/queryClient');
let view: { unmount: () => void } | undefined;
let urlSpy: jest.SpyInstance | undefined;
// Even when a frame fails, its screen unmounts (the workout's clock interval stops) and the cache empties.
afterEach(async () => {
  view?.unmount();
  view = undefined;
  await settleAndClearQueryCache(queryClient);
  urlSpy?.mockRestore();
});

const { SCREENSHOT_TARGETS } = require('../screens') as typeof import('../screens');

describe('App Store frames in screenshot mode', () => {
  it('every frame in SCREENSHOT_TARGETS has its screen listed here, and the rest are shallow', () => {
    expect(Object.keys(FRAME_SCREENS).sort()).toEqual(SCREENSHOT_TARGETS.map((t) => t.slug).sort());
    expect(shallow.length).toBeGreaterThan(50);
  });

  it.each(SCREENSHOT_TARGETS.map((t) => [t.slug, t] as const))(
    '%s reads only routes the screenshot mock answers',
    async (slug, target) => {
      warnings.length = 0;
      errors.length = 0;
      const thrown: Error[] = [];
      urlSpy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(`tgp://screenshot/${slug}`);
      const { ScreenshotNavigator } = require('../ScreenshotNavigator') as typeof import('../ScreenshotNavigator');
      const { ThemeProvider } = require('../../theme/ThemeProvider') as typeof import('../../theme/ThemeProvider');
      view = await render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Catch onError={(e) => thrown.push(e)}><ScreenshotNavigator /></Catch>
          </ThemeProvider>
        </QueryClientProvider>,
      );
      // The capture waits for the frame's ready text, then lets it settle before it checks the console.
      expect((await screen.findAllByText(new RegExp(target.readyText), {}, { timeout: 15000 })).length).toBeGreaterThan(0);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
      expect(warnings.filter((w) => w.includes(MISS))).toEqual([]);
      // Then every read the frame started has answered (a read that starts after another answers is checked too).
      await waitFor(() => expect(queryClient.isFetching()).toBe(0), { timeout: 15000 });
      expect(warnings.filter((w) => w.includes(MISS))).toEqual([]);
      expect(thrown).toEqual([]);
      // The capture also fails a frame on any console error.
      expect(errors).toEqual([]);
    },
    60000,
  );
});
