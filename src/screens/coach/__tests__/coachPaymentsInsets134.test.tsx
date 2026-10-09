// COACH-INSETS-B-134 (agent 134; B13 B28 B39 B16 B29), PR 2: the coach
// payments screens (Packages, package edit, contents, subscribers, Payouts)
// take their top from the shared Screen module (react-native-safe-area-context
// insets + 12 pt), never a fixed 56, and their corners from the rounded radius
// tokens (owner 17:07 "nice rounded corners, luxurious, not rectangles").
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { layout } from '../../../theme/tokens';
import CoachPackagesListScreen from '../payments/CoachPackagesListScreen';
import CoachPackageSubscribersScreen from '../payments/CoachPackageSubscribersScreen';

jest.mock('../../../api/packagesApi', () => ({
  coachPackagesApi: {
    list: jest.fn().mockResolvedValue({ data: [] }),
    subscribers: jest.fn().mockResolvedValue({
      data: { subscribers: [], totalActive: 0, monthlyRecurringRevenueCents: null, currency: null, nextOffset: null },
    }),
  },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));

// The two phones the Q5 bar names: a 360x800 Android (edge-to-edge, 24 pt
// status bar) and a 390x844 iPhone (47 pt notch inset).
const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];

const nav = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const SCREENS = [
  ['Packages', 'coach-packages', () => <CoachPackagesListScreen navigation={nav as never} />],
  [
    'Subscribers',
    'coach-package-subscribers',
    () => (
      <CoachPackageSubscribersScreen
        navigation={nav as never}
        route={{ key: 's', name: 'CoachPackageSubscribers', params: { packageId: 'p1', title: 'Twelve weeks' } } as never}
      />
    ),
  ],
] as const;

describe.each(DEVICES)('inset top on $name', (device) => {
  it.each(SCREENS)('%s sits insets.top + 12 under the status bar, with Back still there', async (_label, id, Comp) => {
    const view = await render(
      <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>
        <Comp />
      </SafeAreaProvider>,
    );
    const root = StyleSheet.flatten(view.getByTestId(id).props.style);
    expect(root.paddingTop).toBe(device.insets.top + layout.statusBarGap);
    expect(view.getByLabelText('Go back')).toBeTruthy();
  });
});

// ── Source guard over every file in this PR ─────────────────────────────────
const DIR = path.resolve(__dirname, '..', 'payments');
const WRAPPED = ['CoachPackagesListScreen', 'CoachPackageContentsScreen', 'CoachPackageSubscribersScreen', 'CoachConnectScreen'];
const ALL = [...WRAPPED, 'CoachPackageEditScreen'];
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (n: string) => strip(fs.readFileSync(path.join(DIR, `${n}.tsx`), 'utf8'));

describe('coach payments insets and corners (source)', () => {
  it.each(ALL)('%s has no literal or legacy radius', (n) => {
    expect(read(n).match(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*\d+/g)).toBeNull();
    expect(read(n)).not.toMatch(/radius\.(?:sm|md|lg|xl)\b/);
  });

  it.each(ALL)('%s has no fixed status-bar top and no react-native SafeAreaView', (n) => {
    const blocks = read(n).match(/\b(?:topBar|header|content|container)\s*:\s*\{[^}]*\}/g) ?? [];
    for (const b of blocks) expect({ b, fixed: /paddingTop:\s*(?:[4-9]\d)\b/.test(b) }).toEqual({ b, fixed: false });
    expect(read(n)).not.toMatch(/import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*'react-native'/);
  });

  it.each(WRAPPED)('%s takes its top from the shared Screen', (n) => {
    expect(read(n)).toMatch(/import \{ Screen \} from '\.\.\/\.\.\/\.\.\/ui'/);
    expect(read(n)).toMatch(/<Screen\b[^>]*edges=\{\['top'\]\}/);
  });

  it('package edit keeps its keyboard column and takes both top bars from the inset hook', () => {
    const src = read('CoachPackageEditScreen');
    expect(src).toMatch(/import \{ useScreenInsets \} from "\.\.\/\.\.\/\.\.\/ui"/);
    expect(src).toMatch(/paddingTop: insets\.top \+ layout\.statusBarGap/);
    // iOS page sheet sits below the status bar; Android opens the preview full screen.
    expect(src).toMatch(/\(Platform\.OS === "ios" \? 0 : insets\.top\) \+ layout\.statusBarGap/);
    expect(src.match(/style=\{\[styles\.topBar, (?:topBarInset|previewBarInset)\]\}/g)).toHaveLength(2);
  });
});
