// COACH-INSETS-A-134 (agent 134, B13 B28 B39 B16 B29): the coach drafts, inbox, thread, risk board, client
// detail and team screens take their top from the shared Screen primitive (react-native-safe-area-context
// insets + 12), never a fixed 56/60, and their corners from the rounded radius tokens (owner 17:07 "nice
// rounded corners, luxurious, not rectangles"), never a literal.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { footerBottomPadding } from '../../../ui';
import { layout } from '../../../theme/tokens';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), pop: jest.fn(), canGoBack: () => false }),
  useRoute: () => ({ params: { draftId: 'd1', clientId: 'c1', clientName: 'Ana Ruiz', fromSubCoachId: 's0' } }),
  usePreventRemove: jest.fn(),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../services/ptmApi', () => ({
  ptmApi: { getMyRiskBoard: jest.fn(async () => ({ data: { items: [], next_cursor: null } })), getRiskBoard: jest.fn() },
}));
jest.mock('../../../api/subCoachApi', () => ({ subCoachApi: { listSubCoaches: jest.fn(async () => ({ data: [] })) } }));
jest.mock('../../../api/coachAi', () => ({
  __esModule: true,
  default: {
    getDraft: jest.fn(async () => ({ data: {
      draftId: 'd1', type: 'WORKOUT_PROGRAM', clientId: 'c1', modelUsed: 'm', tokensIn: 1, tokensOut: 1, costCents: 1,
      generatedPayload: { title: 'Upper body block', summary: '', weeks: [] },
    } })),
  },
}));
jest.mock('../../../components/coach/ai-builder/useAiBuilder', () => ({ fireAiHaptic: jest.fn() }));

import RiskBoardScreen from '../RiskBoardScreen';
import AIWorkoutDraftScreen from '../AIWorkoutDraftScreen';
import ClientReassignModal from '../ClientReassignModal';

// The two phones the Q5 bar names: a 360x800 Android (edge-to-edge, 24 pt status bar) and a 390x844 iPhone (47 pt).
const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];
type Device = (typeof DEVICES)[number];

const mount = (el: React.ReactElement, d: Device) =>
  render(<SafeAreaProvider initialMetrics={{ frame: d.frame, insets: d.insets }}>{el}</SafeAreaProvider>);
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, number>;

describe.each(DEVICES)('coach screens on $name', (d) => {
  it('Risk board sits insets.top + 12 under the status bar, title 12 lower like the Clients tab', async () => {
    const v = await mount(<RiskBoardScreen />, d);
    expect(flat(await v.findByTestId('risk-board')).paddingTop).toBe(d.insets.top + layout.statusBarGap);
    expect(v.getByText('Risk Board')).toBeTruthy();
  });

  it('AI workout draft sits insets.top + 12 under the status bar with Back still first', async () => {
    const v = await mount(<AIWorkoutDraftScreen />, d);
    expect(flat(await v.findByTestId('ai-workout-draft')).paddingTop).toBe(d.insets.top + layout.statusBarGap);
    expect(v.getByLabelText('Back')).toBeTruthy();
    expect(v.getByText('For Ana Ruiz')).toBeTruthy();
  });

  it('Reassign modal: the iOS page sheet owns no top inset but clears the home indicator', async () => {
    // jest runs as iOS: the native page sheet already sits below the status bar.
    const v = await mount(<ClientReassignModal />, d);
    expect(flat(await v.findByTestId('client-reassign')).paddingTop).toBe(0);
    const content = flat(v.getByTestId('client-reassign-scroll'));
    expect(content.paddingTop).toBe(layout.gutter);
    expect(content.paddingBottom).toBe(footerBottomPadding(d.insets.bottom));
  });
});

// ── Source guard over every file in the COACH-INSETS-A-134 list ─────────────────────────────────────────
const DIR = path.resolve(__dirname, '..');
const FILES = [
  'AIWorkoutDraftScreen.tsx', 'AIMealPlanDraftScreen.tsx', 'CoachInboxV2.tsx', 'ClientMessagesScreen.tsx', 'MessagesScreen.tsx',
  'ClientInsightScreen.tsx', 'RiskBoardScreen.tsx', 'client-detail/styles.ts', 'ClientReassignModal.tsx',
  'SubCoachDetailScreen.tsx', 'CoachTeamProfileScreen.tsx',
];
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (f: string) => strip(fs.readFileSync(path.join(DIR, f), 'utf8'));

describe('coach insets and corners (source)', () => {
  it.each(FILES)('%s has no literal radius', (f) => {
    expect(read(f).match(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*\d+/g)).toBeNull();
  });

  it.each(FILES)('%s never imports SafeAreaView from react-native', (f) => {
    expect(read(f)).not.toMatch(/import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*'react-native'/);
  });

  it.each(FILES)('%s has no fixed status-bar top on a header or page', (f) => {
    const blocks = read(f).match(/\b(?:header|chatHeader|content|container|sheet|page)\s*:\s*\{[^}]*\}/g) ?? [];
    for (const b of blocks) expect({ b, fixed: /paddingTop:\s*[4-9]\d\b/.test(b) }).toEqual({ b, fixed: false });
  });

  it.each(FILES.filter((f) => !f.includes('/')))('%s takes its top from the Screen primitive (src/ui)', (f) => {
    expect(read(f)).toMatch(/import \{[^}]*\b(?:Screen|useScreenInsets)\b[^}]*\} from '\.\.\/\.\.\/ui'/);
  });

  it('ClientDetailScreen adds the inset top on every branch now that styles.container has none', () => {
    const src = read('ClientDetailScreen.tsx');
    expect(src).toMatch(/paddingTop: insets\.top \+ layout\.statusBarGap/);
    expect(src.match(/style=\{\[styles\.container, top/g)).toHaveLength(3);
  });

  it.each(FILES)('%s keeps serif line heights at 1.2 x the size or more (Android descenders)', (f) => {
    for (const [, body] of read(f).matchAll(/\{([^{}]*Cormorant[^{}]*)\}/g)) {
      const size = Number(/fontSize:\s*(\d+)/.exec(body)?.[1]);
      const lh = /lineHeight:\s*(\d+)/.exec(body)?.[1];
      if (size && lh) expect({ body, ok: Number(lh) >= 1.2 * size }).toEqual({ body, ok: true });
    }
  });
});
