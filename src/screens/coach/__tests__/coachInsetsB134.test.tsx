// COACH-INSETS-B-134 (agent 134; B13 B28 B39 B16 B29): the coach team,
// codes, invites and templates screens take their top from the shared Screen
// (react-native-safe-area-context insets + 12 pt), never a fixed 56/60 or
// SafeAreaView from 'react-native', and their corners from the rounded radius
// tokens (owner 17:07 "nice rounded corners, luxurious, not rectangles").
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { layout } from '../../../theme/tokens';
import CoachInvitesScreen from '../CoachInvitesScreen';
import InviteCodeRedeemersScreen from '../InviteCodeRedeemersScreen';

jest.mock('../../../services/api', () => ({
  coachApi: { getInviteCodeRedeemers: jest.fn().mockResolvedValue({ data: { redeemers: [] } }) },
}));
jest.mock('../../../api/invites', () => ({
  invitesApi: { listInvites: jest.fn().mockResolvedValue([]), resendInvite: jest.fn(), revokeInvite: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));

// The two phones the Q5 bar names: a 360x800 Android (edge-to-edge, 24 pt
// status bar) and a 390x844 iPhone (47 pt notch inset).
const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];

const nav = { goBack: jest.fn(), navigate: jest.fn() };
const SCREENS = [
  ['Invites', 'coach-invites', () => <CoachInvitesScreen navigation={nav as never} />, 'Go back'],
  [
    'Who joined',
    'invite-code-redeemers',
    () => (
      <InviteCodeRedeemersScreen
        navigation={nav}
        route={{ key: 'r', name: 'InviteCodeRedeemers', params: { inviteCodeId: 'c1', code: 'TGP-1' } }}
      />
    ),
    'Back',
  ],
] as const;

describe.each(DEVICES)('inset top on $name', (device) => {
  it.each(SCREENS)('%s sits insets.top + 12 under the status bar, with Back still there', async (_label, id, Comp, back) => {
    const view = await render(
      <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>
        <Comp />
      </SafeAreaProvider>,
    );
    const root = StyleSheet.flatten(view.getByTestId(id).props.style);
    expect(root.paddingTop).toBe(device.insets.top + layout.statusBarGap);
    expect(view.getByLabelText(back)).toBeTruthy();
  });
});

// ── Source guard over every file in this PR ─────────────────────────────────
const DIR = path.resolve(__dirname, '..');
const FILES = [
  'TeamManagementScreen', 'InviteCodesScreen', 'CoachInvitesScreen',
  'InviteCodeRedeemersScreen', 'ProgramTemplatesScreen',
].map((n) => path.join(DIR, `${n}.tsx`));
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (f: string) => strip(fs.readFileSync(f, 'utf8'));
const cases = FILES.map((f) => [path.basename(f), f]);

describe('coach insets and corners (source)', () => {
  it.each([...cases, ['ClientsListScreen.tsx', path.join(DIR, 'ClientsListScreen.tsx')]])('%s has no literal radius', (_n, f) => {
    expect(read(f).match(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*\d+/g)).toBeNull();
  });

  it.each(cases)('%s never imports SafeAreaView from react-native', (_n, f) => {
    expect(read(f)).not.toMatch(/import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*'react-native'/);
  });

  it.each(cases)('%s has no fixed status-bar top on a header or page', (_n, f) => {
    const blocks = read(f).match(/\b(?:header|topBar|content|container|safe)\s*:\s*\{[^}]*\}/g) ?? [];
    for (const b of blocks) expect({ b, fixed: /paddingTop:\s*(?:[4-9]\d)\b/.test(b) }).toEqual({ b, fixed: false });
  });

  it.each(cases)('%s takes its top from the shared Screen', (_n, f) => {
    expect(read(f)).toMatch(/import \{ Screen \} from '\.\.\/\.\.\/ui'/);
    expect(read(f)).toMatch(/<Screen\b[^>]*edges=\{\['top'\]\}/);
  });
});
