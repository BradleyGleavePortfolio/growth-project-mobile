/**
 * OFFLINE-BAND-IPHONE-M (203-D58 op 1, #203-E113): the app lays the offline band out from the very top of the screen
 * (RootNavigator's first child, nothing pads it) and draws its own opaque top strip over it (StatusBarBand: absolute,
 * top 0, as tall as the phone's top inset, zIndex 1000). On the usual iPhone (top inset 47 pt) none of the band's words
 * showed. C1 Style C v2 C2_offline_ios390_100 draws the ink from where the strip ends and the first line 9 pt under it,
 * so on iPhone the band's top padding is the phone's top inset plus 9, read from the one SafeAreaProvider (0 with none,
 * as these tests and the three bare band tests render it). Android keeps its rule: the status bar height plus 9, never
 * the safe-area inset as well (under edge to edge both are the same 24 pt, and the band would grow by a second 24 pt).
 *
 * The Android rule is read when the band's module loads (StyleSheet.create), so each platform gets its own copy of the
 * band, React, the renderer and the safe-area context, loaded after Platform.OS and StatusBar.currentHeight are set
 * (jest.isolateModules). A module loaded that way still reads React Native's lazy exports from the test's own registry
 * when it renders (after isolateModules returns), so that registry's Platform.OS and StatusBar.currentHeight answer for
 * the same phone while it renders, as one phone's do at load and at render. The real SafeAreaInsetsContext.Provider
 * gives the inset; the package is not mocked.
 */
import { Platform, StatusBar } from 'react-native';
import { colors, layout } from '../../theme/tokens';

// As the real hook (src/hooks/useNetworkStatus.ts): a hook of its own, so the band's hooks run on every render.
const mockNet = { offline: true };
jest.mock('../../hooks/useNetworkStatus', () => {
  const { useRef } = require('react');
  return {
    useNetworkStatus: () => {
      useRef(null);
      return mockNet.offline ? { isOnline: false, isInternetReachable: false } : { isOnline: true, isInternetReachable: true };
    },
    // The app's rule (useNetworkStatus.ts:60-64).
    isEffectivelyOnline: (s: { isOnline: boolean; isInternetReachable: boolean | null }) =>
      s.isOnline && s.isInternetReachable !== false,
  };
});
const mockUser: { current: { role?: string } | null } = { current: { role: 'client' } };
jest.mock('../../lib/userCache', () => ({ readUserCacheSync: () => mockUser.current }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const CLIENT_LINE = 'You are offline. Workouts and food logs are saved on this phone and sync when you reconnect.';
const COACH_LINE = 'You are offline. Reconnect to see the latest.';

type Style = Record<string, unknown>;
type HostNode = { props: Record<string, unknown>; parent: HostNode | null };
type Kit = {
  React: typeof import('react');
  RNTL: typeof import('@testing-library/react-native/pure');
  flatten: (style: unknown) => Style;
  SafeAreaInsetsContext: typeof import('react-native-safe-area-context').SafeAreaInsetsContext;
  Band: () => unknown;
  /** Makes the test's own registry answer as this phone while the band renders. */
  phone: () => void;
};
const realOS = Platform.OS;
const realHeight = StatusBar.currentHeight;
const answerAs = (os: string, height: number | null | undefined) => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Object.defineProperty(StatusBar, 'currentHeight', { configurable: true, value: height });
};

function loadBand(os: 'ios' | 'android', statusBarHeight: number | null | undefined): Kit {
  let kit: Kit | undefined;
  jest.isolateModules(() => {
    const RN = require('react-native') as typeof import('react-native');
    const statusBar = RN.StatusBar; // loaded before the switch, then given the phone's value
    Object.defineProperty(RN.Platform, 'OS', { configurable: true, get: () => os });
    Object.defineProperty(statusBar, 'currentHeight', { configurable: true, value: statusBarHeight });
    kit = {
      React: require('react'),
      RNTL: require('@testing-library/react-native/pure'),
      flatten: (style) => RN.StyleSheet.flatten(style as never) as Style,
      SafeAreaInsetsContext: require('react-native-safe-area-context').SafeAreaInsetsContext,
      Band: require('../OfflineBanner').default,
      phone: () => answerAs(os, statusBarHeight),
    };
  });
  return kit!;
}

// iPhone: React Native reports no status bar height there (StatusBar.currentHeight is Android only).
const IPHONE = loadBand('ios', null);
const ANDROID = loadBand('android', 24);
const ANDROID_NO_HEIGHT = loadBand('android', undefined);

// The tree the root gives the band: the one SafeAreaProvider's insets (App.tsx), or no provider at all.
const tree = (kit: Kit, top: number | null) => {
  const band = kit.React.createElement(kit.Band as never);
  return top === null
    ? band
    : kit.React.createElement(kit.SafeAreaInsetsContext.Provider, { value: { top, bottom: 34, left: 0, right: 0 } }, band);
};
const mount = (kit: Kit, top: number | null) => {
  kit.phone();
  return kit.RNTL.render(tree(kit, top));
};
type View = Awaited<ReturnType<typeof mount>>;
const bandOf = (view: View, words: string) => {
  let node = view.getByText(words) as unknown as HostNode | null;
  while (node && node.props.accessibilityRole !== 'alert') node = node.parent;
  if (!node) throw new Error('no alert band around the words');
  return node;
};
const padding = (kit: Kit, node: HostNode) => {
  const s = kit.flatten(node.props.style);
  return { top: s.paddingTop ?? s.paddingVertical ?? s.padding, bottom: s.paddingBottom ?? s.paddingVertical ?? s.padding };
};
const lines = [['client', CLIENT_LINE], ['coach', COACH_LINE]] as const;

afterEach(async () => {
  for (const kit of [IPHONE, ANDROID, ANDROID_NO_HEIGHT]) await kit.RNTL.cleanup();
  mockNet.offline = true;
  mockUser.current = { role: 'client' };
  answerAs(realOS, realHeight);
});

describe('on iPhone the band starts where the top strip ends: top padding = the top inset + 9', () => {
  const rows = [0, 20, 47, 59, 62].flatMap((top) => lines.map(([role, words]) => [top, role, words] as const));
  it.each(rows)('top inset %i pt, the %s line', async (top, role, words) => {
    mockUser.current = { role };
    const view = await mount(IPHONE, top);
    expect(padding(IPHONE, bandOf(view, words))).toEqual({ top: top + 9, bottom: 9 });
  });

  it.each(lines)('no provider at all (tests, previews), the %s line: 9 pt, no throw', async (role, words) => {
    mockUser.current = { role };
    const view = await mount(IPHONE, null);
    expect(padding(IPHONE, bandOf(view, words))).toEqual({ top: 9, bottom: 9 });
  });
});

describe('on Android the status bar height decides, never the safe-area inset as well', () => {
  it.each([24, 47, null])('status bar 24 pt, provider top %p: 33 pt (never 57 or 80)', async (top) => {
    const view = await mount(ANDROID, top);
    expect(padding(ANDROID, bandOf(view, CLIENT_LINE))).toEqual({ top: 33, bottom: 9 });
  });

  it.each([24, null])('no status bar height reported, provider top %p: 9 pt', async (top) => {
    const view = await mount(ANDROID_NO_HEIGHT, top);
    expect(padding(ANDROID_NO_HEIGHT, bandOf(view, CLIENT_LINE))).toEqual({ top: 9, bottom: 9 });
  });
});

describe('the band is still the approved band (#203-E113): an alert read out politely, its words, look and cap', () => {
  it.each([['iPhone', IPHONE, 47], ['Android', ANDROID, 24]] as const)('%s', async (_name, kit, top) => {
    for (const [role, words] of lines) {
      mockUser.current = { role };
      const view = await mount(kit, top);
      const band = bandOf(view, words);
      expect(band.props.accessibilityRole).toBe('alert');
      expect(band.props.accessibilityLiveRegion).toBe('polite');
      expect(kit.flatten(band.props.style)).toMatchObject({
        flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ink, paddingHorizontal: layout.gutter,
      });
      expect(view.getByText(words).props.maxFontSizeMultiplier).toBe(1.3);
      await view.unmount();
    }
  });
});

it('offline, online, offline on one mounted iPhone tree: no hooks error, no band while online', async () => {
  const errors = jest.spyOn(console, 'error');
  try {
    const view = await mount(IPHONE, 47);
    expect(view.getByText(CLIENT_LINE)).toBeTruthy();
    mockNet.offline = false;
    await view.rerender(tree(IPHONE, 47));
    expect(view.queryByText(CLIENT_LINE)).toBeNull();
    expect(view.toJSON()).toBeNull();
    mockNet.offline = true;
    await view.rerender(tree(IPHONE, 47));
    expect(bandOf(view, CLIENT_LINE).props.accessibilityRole).toBe('alert');
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
