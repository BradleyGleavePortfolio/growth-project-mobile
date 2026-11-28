/**
 * OFFLINE-BAND-ROOT-M (T1): the screen area's own SafeAreaProvider (src/ui/layout/ScreenArea.tsx), as RootNavigator
 * mounts it under the offline band. C1 Style C v2 C2_offline_* draws each screen right under the band as it sits under
 * the top strip online; before this the screens under the band still read the window's top inset (47 pt on the 390
 * iPhone) and started that much lower, and every screen's KeyboardAvoidingView missed the band's 101 pt (LS-BAND-1 C1).
 *
 * The real react-native-safe-area-context (no package mock). The area's native view is the host element
 * RNCSafeAreaProvider (testID screen-area); the values a phone sends on layout are fired by hand on its onInsetsChange,
 * inside act: offline on the 390 iPhone the area starts at the band's bottom (frame y 101) and its own top inset is 0;
 * online it sits at the window's origin with the window's insets. The app's one provider above (App.tsx) is a real
 * SafeAreaProvider with the window's metrics. Android rows load the modules after the platform is set
 * (jest.isolateModules) and answer as that phone while they render, as offlineBannerIphoneInset.test.tsx does.
 * Fictional people: client Jordan, coach Sam.
 */
import React from 'react';
import { Dimensions, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider, useSafeAreaInsets, type Metrics } from 'react-native-safe-area-context';
import { layout } from '../../../theme/tokens';
import { ScreenArea, useScreenAreaKeyboardOffset, useWindowInsets } from '../ScreenArea';
import { Screen, useScreenInsets } from '../Screen';
import OfflineBanner from '../../../components/OfflineBanner';
import FoodSearchModal from '../../../components/log/FoodSearchModal';
import WorkoutSummaryC5, { type WorkoutSummaryC5Props } from '../../../screens/client/active-workout/WorkoutSummaryC5';

// The network as the real hook reports it (useNetworkStatus.ts), switchable while the tree stays mounted.
const mockNet = { offline: true, listeners: new Set<() => void>() };
jest.mock('../../../hooks/useNetworkStatus', () => {
  const { useSyncExternalStore } = require('react');
  const subscribe = (cb: () => void) => {
    mockNet.listeners.add(cb);
    return () => mockNet.listeners.delete(cb);
  };
  return {
    useNetworkStatus: () =>
      useSyncExternalStore(subscribe, () => mockNet.offline)
        ? { isOnline: false, isInternetReachable: false }
        : { isOnline: true, isInternetReachable: true },
    isEffectivelyOnline: (s: { isOnline: boolean; isInternetReachable: boolean | null }) =>
      s.isOnline && s.isInternetReachable !== false,
  };
});
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ role: 'client' }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/log/FoodSearchView', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/log/ManualFoodEntryForm', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: [{ id: 'asg-jordan', scheduled_for: '2026-11-27', completed_at: null }] }),
}));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'coach-sam', name: 'Sam Rivers' }] }) }));

const setOffline = async (offline: boolean) => {
  await act(async () => {
    mockNet.offline = offline;
    for (const l of mockNet.listeners) l();
  });
};

type Insets = { top: number; bottom: number; left: number; right: number };
const insets = (top: number, bottom: number): Insets => ({ top, bottom, left: 0, right: 0 });
const metrics = (top: number, bottom: number, y: number, width: number, height: number): Metrics => ({
  insets: insets(top, bottom),
  frame: { x: 0, y, width, height },
});
// The window (App.tsx's provider) and what the area's native view sends: offline under the band, online at the origin.
const PHONES = {
  iphone390: { window: metrics(47, 34, 0, 390, 844), offline: metrics(0, 34, 101, 390, 743), online: metrics(47, 34, 0, 390, 844) },
  iphone393: { window: metrics(59, 34, 0, 393, 852), offline: metrics(0, 34, 113, 393, 739), online: metrics(59, 34, 0, 393, 852) },
  android360: { window: metrics(24, 16, 0, 360, 800), offline: metrics(0, 16, 96, 360, 704), online: metrics(24, 16, 0, 360, 800) },
};

type Seen = { insets: Insets; screen: Insets; window: Insets; offset: number };
function Probe({ name }: { name: string }) {
  const seen: Seen = { insets: useSafeAreaInsets(), screen: useScreenInsets(), window: useWindowInsets(), offset: useScreenAreaKeyboardOffset() };
  return <Text testID={`probe-${name}`}>{JSON.stringify(seen)}</Text>;
}
// Inside the area, with no provider above it: useSafeAreaInsets would throw without one, so it is not read here.
function BareProbe() {
  const seen = { screen: useScreenInsets(), window: useWindowInsets(), offset: useScreenAreaKeyboardOffset() };
  return <Text testID="probe-bare">{JSON.stringify(seen)}</Text>;
}
type Rendered = Awaited<ReturnType<typeof render>>;
const read = (view: Rendered, name: string): Seen => JSON.parse(String(view.getByTestId(`probe-${name}`).props.children));
const send = async (view: Rendered, m: Metrics) => {
  const area = view.getByTestId('screen-area');
  await act(async () => {
    (area.props.onInsetsChange as (e: { nativeEvent: Metrics }) => void)({ nativeEvent: m });
  });
};
const style = (node: { props: Record<string, unknown> }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

// What each KeyboardAvoidingView was last rendered with (the offset is not passed on to its host view).
type KavProps = { keyboardVerticalOffset?: number; behavior?: string; testID?: string };
const kavRenders: KavProps[] = [];
function spyOnKeyboardViews(...classes: Array<typeof KeyboardAvoidingView>) {
  const spies = [...new Set(classes)].map((C) => {
    const original = C.prototype.render;
    return jest.spyOn(C.prototype, 'render').mockImplementation(function (this: { props: KavProps }) {
      kavRenders.push(this.props);
      return original.call(this);
    });
  });
  return () => spies.forEach((s) => s.mockRestore());
}
const lastKav = () => kavRenders[kavRenders.length - 1];

const realOS = Platform.OS;
const answerAs = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
type Kit = {
  React: typeof import('react');
  RNTL: typeof import('@testing-library/react-native/pure');
  SafeArea: typeof import('react-native-safe-area-context');
  Area: typeof import('../ScreenArea');
  ScreenModule: typeof import('../Screen');
  Kav: typeof KeyboardAvoidingView;
  phone: () => void;
};
function loadKit(os: 'ios' | 'android'): Kit {
  let kit: Kit | undefined;
  jest.isolateModules(() => {
    const RN = require('react-native') as typeof import('react-native');
    Object.defineProperty(RN.Platform, 'OS', { configurable: true, get: () => os });
    kit = {
      React: require('react'),
      RNTL: require('@testing-library/react-native/pure'),
      SafeArea: require('react-native-safe-area-context'),
      Area: require('../ScreenArea'),
      ScreenModule: require('../Screen'),
      Kav: RN.KeyboardAvoidingView,
      phone: () => answerAs(os),
    };
  });
  return kit!;
}
const KITS = { ios: loadKit('ios'), android: loadKit('android') };

afterEach(async () => {
  for (const kit of Object.values(KITS)) await kit.RNTL.cleanup();
  mockNet.offline = true;
  kavRenders.length = 0;
  answerAs(realOS);
});

describe('a. the children render on the first frame', () => {
  it('with no provider above: insets 0, offset 0', async () => {
    const view = await render(<ScreenArea><BareProbe /></ScreenArea>);
    expect(JSON.parse(String(view.getByTestId('probe-bare').props.children))).toEqual({ screen: insets(0, 0), window: insets(0, 0), offset: 0 });
  });
  it("with App's provider above (390 x 844, insets 47 / 34): the window's insets, before the area's first event", async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={PHONES.iphone390.window}><ScreenArea><Probe name="in" /></ScreenArea></SafeAreaProvider>,
    );
    expect(read(view, 'in')).toEqual({ insets: insets(47, 34), screen: insets(47, 34), window: insets(47, 34), offset: 0 });
  });
});

describe('b, c. inside the area a screen reads the area; outside (the band, the push slip) reads the window', () => {
  const tree = (
    <SafeAreaProvider initialMetrics={PHONES.iphone390.window}>
      <View style={{ flex: 1 }}>
        <Probe name="out" />
        <ScreenArea><Probe name="in" /></ScreenArea>
      </View>
    </SafeAreaProvider>
  );
  it('b. offline on the 390 iPhone (the area at y 101, its top inset 0)', async () => {
    const view = await render(tree);
    await send(view, PHONES.iphone390.offline);
    expect(read(view, 'in')).toEqual({ insets: insets(0, 34), screen: insets(0, 34), window: insets(47, 34), offset: 101 });
    expect(read(view, 'out')).toEqual({ insets: insets(47, 34), screen: insets(47, 34), window: insets(47, 34), offset: 0 });
  });
  it('c. online (the area at the origin): every reader inside and outside reads 47', async () => {
    const view = await render(tree);
    await send(view, PHONES.iphone390.offline);
    await send(view, PHONES.iphone390.online);
    expect(read(view, 'in')).toEqual({ insets: insets(47, 34), screen: insets(47, 34), window: insets(47, 34), offset: 0 });
    expect(read(view, 'out')).toEqual({ insets: insets(47, 34), screen: insets(47, 34), window: insets(47, 34), offset: 0 });
  });
});

describe('d. the keyboard offset is the area top on iPhone only', () => {
  const offsetOn = async (kit: Kit, phone: (typeof PHONES)[keyof typeof PHONES], state: 'offline' | 'online') => {
    const { React: R, RNTL, SafeArea, Area } = kit;
    function Offset() {
      return R.createElement(Text, { testID: 'offset' }, String(Area.useScreenAreaKeyboardOffset()));
    }
    kit.phone();
    const view = await RNTL.render(
      R.createElement(SafeArea.SafeAreaProvider, { initialMetrics: phone.window }, R.createElement(Area.ScreenArea, null, R.createElement(Offset))),
    );
    const area = view.getByTestId('screen-area');
    await RNTL.act(async () => {
      (area.props.onInsetsChange as (e: { nativeEvent: Metrics }) => void)({ nativeEvent: phone[state] });
    });
    return Number(view.getByTestId('offset').props.children);
  };
  it.each([
    ['iPhone 390 offline', 'ios', 'iphone390', 'offline', 101],
    ['iPhone 390 online', 'ios', 'iphone390', 'online', 0],
    ['iPhone 393 offline', 'ios', 'iphone393', 'offline', 113],
    ['Android 360 offline', 'android', 'android360', 'offline', 0],
    ['Android 360 online', 'android', 'android360', 'online', 0],
  ] as const)('%s', async (_name, os, phone, state, offset) => {
    expect(await offsetOn(KITS[os], PHONES[phone], state)).toBe(offset);
  });
});

describe("e, h. the shared Screen: its keyboard view counts the area's place; a Screen in a Modal (inModal) does not", () => {
  const mountScreen = async (os: 'ios' | 'android', inModal: boolean, state: 'offline' | 'online') => {
    const kit = KITS[os];
    const phone = os === 'ios' ? PHONES.iphone390 : PHONES.android360;
    const { React: R, RNTL, SafeArea, Area, ScreenModule } = kit;
    const restore = spyOnKeyboardViews(KeyboardAvoidingView, kit.Kav);
    try {
      kit.phone();
      const screen = R.createElement(
        ScreenModule.Screen,
        { inModal, testID: 'jordan-note', footer: R.createElement(Text, null, 'Send to Sam') },
        R.createElement(Text, null, 'How did it feel?'),
      );
      const view = await RNTL.render(
        R.createElement(SafeArea.SafeAreaProvider, { initialMetrics: phone.window }, R.createElement(Area.ScreenArea, null, screen)),
      );
      const area = view.getByTestId('screen-area');
      await RNTL.act(async () => {
        (area.props.onInsetsChange as (e: { nativeEvent: Metrics }) => void)({ nativeEvent: phone[state] });
      });
      return { top: style(view.getByTestId('jordan-note')).paddingTop, kav: lastKav() };
    } finally {
      restore();
    }
  };
  const gap = layout.statusBarGap;
  it.each([
    // e: a screen under the band (not in a Modal)
    ['e. iPhone, offline', 'ios', false, 'offline', 0 + gap, 101, 'padding'],
    ['e. iPhone, online', 'ios', false, 'online', 47 + gap, 0, 'padding'],
    ['e. Android, offline', 'android', false, 'offline', 0 + gap, 0, 'height'],
    ['e. Android, online', 'android', false, 'online', 24 + gap, 0, 'height'],
    // h: a Screen drawn inside a Modal, which draws from the window's top over the band in its own window
    ['h. iPhone, offline', 'ios', true, 'offline', 47 + gap, 0, 'padding'],
    ['h. iPhone, online', 'ios', true, 'online', 47 + gap, 0, 'padding'],
    ['h. Android, offline', 'android', true, 'offline', 24 + gap, 0, 'height'],
    ['h. Android, online', 'android', true, 'online', 24 + gap, 0, 'height'],
  ] as const)('%s', async (_name, os, inModal, state, top, offset, behavior) => {
    const got = await mountScreen(os, inModal, state);
    expect(got.top).toBe(top);
    expect(got.kav?.keyboardVerticalOffset ?? 0).toBe(offset);
    expect(got.kav?.behavior).toBe(behavior);
  });
});

describe('f. the band flips on one mounted tree: nothing under it remounts', () => {
  it('offline, online, offline: the band shows, hides, shows; the child under the area mounts once', async () => {
    let mounts = 0;
    function JordanDraft() {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <Text testID="jordan-draft">Felt strong today</Text>;
    }
    const view = await render(
      <SafeAreaProvider initialMetrics={PHONES.iphone390.window}>
        <View style={{ flex: 1 }}>
          <OfflineBanner />
          <ScreenArea><JordanDraft /></ScreenArea>
        </View>
      </SafeAreaProvider>,
    );
    const band = () => view.queryByText('You are offline. Workouts and food logs are saved on this phone and sync when you reconnect.');
    expect(band()).not.toBeNull();
    await send(view, PHONES.iphone390.offline);
    await setOffline(false);
    await send(view, PHONES.iphone390.online);
    expect(band()).toBeNull();
    await setOffline(true);
    await send(view, PHONES.iphone390.offline);
    expect(band()).not.toBeNull();
    expect(view.getByTestId('jordan-draft')).toBeTruthy();
    expect(mounts).toBe(1);
  });
});

describe('g. Food search (a Modal over the Food log) keeps the window top while the area reads 0', () => {
  it('offline on the 390 iPhone: the sheet overlay pads by 47', async () => {
    const props = {
      visible: true, activeMealType: 'lunch' as const, onClose: jest.fn(), searchQuery: '', onSearchChange: jest.fn(),
      onClearSearch: jest.fn(), onRetrySearch: jest.fn(), searching: false, showSlowMessage: false, searchError: null,
      searchResults: [], didYouMean: [], recentTab: 'recent' as const, onRecentTabChange: jest.fn(), recentFoods: [],
      frequentFoods: [], onSelectFood: jest.fn(), manualMode: false, onEnterManualMode: jest.fn(), onExitManualMode: jest.fn(),
      manualFields: { foodName: '', calories: '', protein: '', carbs: '', fat: '', quantity: '1', unit: 'serving' },
      onManualFieldChange: jest.fn(), onManualLog: jest.fn(),
    };
    const view = await render(
      <SafeAreaProvider initialMetrics={PHONES.iphone390.window}>
        <ScreenArea><FoodSearchModal {...(props as unknown as React.ComponentProps<typeof FoodSearchModal>)} /></ScreenArea>
      </SafeAreaProvider>,
    );
    await send(view, PHONES.iphone390.offline);
    // The overlay (its KeyboardAvoidingView's host view) holds the dim and the sheet's frame.
    const frame = view.getByTestId('food-search-frame') as unknown as { parent: { props: Record<string, unknown> } };
    expect(style(frame.parent).paddingTop).toBe(47);
  });
});

describe("i. the workout summary's week ring keeps its online size under the band", () => {
  const props: WorkoutSummaryC5Props = {
    assignmentId: 'asg-jordan', today: '2026-11-27', minutes: 52, sets: 16, volume: 9730, lines: [],
    effort: null, note: '', onEffort: () => undefined, onNote: () => undefined,
    status: 'open', sentKey: null, onSend: () => undefined, onTryAgain: () => undefined, onBack: () => undefined,
  };
  it.each(['offline', 'online'] as const)('393 x 852 (insets 59 / 34), %s: the ring is 160', async (state) => {
    const dims = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 393, height: 852, scale: 3, fontScale: 1 });
    try {
      const view = await render(
        <SafeAreaProvider initialMetrics={PHONES.iphone393.window}><ScreenArea><WorkoutSummaryC5 {...props} /></ScreenArea></SafeAreaProvider>,
      );
      await send(view, PHONES.iphone393[state]);
      expect(style(view.getByTestId('summary-ring')).width).toBe(160);
    } finally {
      dims.mockRestore();
    }
  });
});
