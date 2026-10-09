// COACH-INSETS-A-134 follow-up (agent 134, B08 B29): Risk board, sub-coach detail and Business profile
// hide the native header, so when they are pushed they draw their own Back (iOS has no hardware back):
// the same arrow-back and place as the other coach detail screens, first under the Screen top, 44 pt
// target. With nothing below them (a resume or deep link) there is no dead Back. The page gutters of the
// twelve COACH-INSETS-A-134 files are the 24 pt layout.gutter token, never 16 or 20.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { layout } from '../../../theme/tokens';

let mockCanGoBack = true;
const mockGoBack = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack, canGoBack: () => mockCanGoBack }),
  useRoute: () => ({ params: { subCoachId: 's1' } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../services/ptmApi', () => ({
  ptmApi: { getMyRiskBoard: jest.fn(async () => ({ data: { items: [], next_cursor: null } })), getRiskBoard: jest.fn() },
}));
const mockGetSubCoach = jest.fn();
jest.mock('../../../api/subCoachApi', () => ({
  subCoachApi: { getSubCoach: (...a: unknown[]) => mockGetSubCoach(...a), revokeSubCoach: jest.fn() },
}));
const mockGetProfile = jest.fn();
jest.mock('../../../api/coachTeamApi', () => ({
  coachTeamApi: { getProfile: () => mockGetProfile(), upsertProfile: jest.fn() },
}));

import RiskBoardScreen from '../RiskBoardScreen';
import SubCoachDetailScreen from '../SubCoachDetailScreen';
import CoachTeamProfileScreen from '../CoachTeamProfileScreen';

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];
type Device = (typeof DEVICES)[number];

const mount = (el: React.ReactElement, d: Device) =>
  render(<SafeAreaProvider initialMetrics={{ frame: d.frame, insets: d.insets }}>{el}</SafeAreaProvider>);
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, number>;

const DETAIL = {
  id: 's1', name: 'Mia Chen', email: 'mia@example.com', created_at: '2026-01-01T00:00:00Z',
  coach_profile: null,
  capacity: { subCoachId: 's1', assignedClients: 2, maxClients: 10, planTier: 'pro', hasCapacity: true },
  engagement: {
    subCoachId: 's1', score: 70,
    breakdown: {
      logged_in_within_7d: 1, messaged_within_48h_of_checkin: 1,
      updated_workout_plan_this_week: 1, avg_workout_completion_gte_70: 1,
    },
  },
  clients: [],
};

// A 44 pt Back with the arrow on the 24 pt gutter, first under the Screen top (insets.top + 12).
async function expectBack(v: Awaited<ReturnType<typeof render>>, id: string) {
  const back = v.getByTestId(id);
  expect(back.props.accessibilityLabel).toBe('Back');
  expect(back.props.accessibilityRole).toBe('button');
  const s = flat(back);
  expect(s.width).toBe(layout.touchMin);
  expect(s.height).toBe(layout.touchMin);
  mockGoBack.mockClear();
  await fireEvent.press(back);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  mockCanGoBack = true;
  mockGetSubCoach.mockReset();
  mockGetProfile.mockReset();
});

describe.each(DEVICES)('pushed coach screens on $name', (d) => {
  it('Risk board: Back first under the Screen top', async () => {
    const v = await mount(<RiskBoardScreen />, d);
    expect(flat(await v.findByTestId('risk-board')).paddingTop).toBe(d.insets.top + layout.statusBarGap);
    expect(v.getByText('Risk Board')).toBeTruthy();
    await expectBack(v, 'risk-board-back');
  });

  it('Risk board opened with nothing below it: no Back, title where the tab titles sit', async () => {
    mockCanGoBack = false;
    const v = await mount(<RiskBoardScreen />, d);
    await v.findByTestId('risk-board');
    expect(v.queryByTestId('risk-board-back')).toBeNull();
    expect(v.getByText('Risk Board')).toBeTruthy();
  });

  it('sub-coach detail: Back on the loaded page', async () => {
    mockGetSubCoach.mockResolvedValue({ data: DETAIL });
    const v = await mount(<SubCoachDetailScreen />, d);
    expect(flat(await v.findByTestId('sub-coach-detail')).paddingTop).toBe(d.insets.top + layout.statusBarGap);
    expect(v.getByText('Mia Chen')).toBeTruthy();
    await expectBack(v, 'sub-coach-detail-back');
  });

  it('sub-coach detail: Back on the load error too, inside the Screen insets', async () => {
    mockGetSubCoach.mockRejectedValue(new Error('offline'));
    const v = await mount(<SubCoachDetailScreen />, d);
    expect(flat(await v.findByTestId('sub-coach-detail-error')).paddingTop).toBe(d.insets.top + layout.statusBarGap);
    expect(v.getByText('Retry')).toBeTruthy();
    await expectBack(v, 'sub-coach-detail-back');
  });

  it('Business profile: Back on the setup state', async () => {
    mockGetProfile.mockResolvedValue({ ok: false, reason: 'not_configured' });
    const v = await mount(<CoachTeamProfileScreen />, d);
    expect(flat(await v.findByTestId('team-profile')).paddingTop).toBe(d.insets.top + layout.statusBarGap);
    expect(v.getByText('Set up your business profile')).toBeTruthy();
    await expectBack(v, 'team-profile-back');
  });

  it('Business profile: Back on the load error', async () => {
    mockGetProfile.mockResolvedValue({ ok: false, reason: 'error', message: 'The service is not responding.' });
    const v = await mount(<CoachTeamProfileScreen />, d);
    expect(flat(await v.findByTestId('team-profile')).paddingTop).toBe(d.insets.top + layout.statusBarGap);
    await expectBack(v, 'team-profile-back');
  });

  it('sub-coach detail with nothing below it: no dead Back', async () => {
    mockCanGoBack = false;
    mockGetSubCoach.mockResolvedValue({ data: DETAIL });
    const v = await mount(<SubCoachDetailScreen />, d);
    await v.findByTestId('sub-coach-detail');
    expect(v.queryByTestId('sub-coach-detail-back')).toBeNull();
  });

  it('Business profile with nothing below it: no dead Back', async () => {
    mockCanGoBack = false;
    mockGetProfile.mockResolvedValue({ ok: false, reason: 'not_configured' });
    const v = await mount(<CoachTeamProfileScreen />, d);
    await v.findByTestId('team-profile');
    expect(v.queryByTestId('team-profile-back')).toBeNull();
  });
});

// ── Source guard: page gutters are the 24 pt token on the twelve files ──────────────────────
const ROOT = path.join(__dirname, '..');
const GUTTERS: Array<[string, string[]]> = [
  ['AIWorkoutDraftScreen.tsx', ['header', 'scrollContent', 'footer']],
  ['AIMealPlanDraftScreen.tsx', ['header', 'scrollContent', 'footer']],
  ['ClientInsightScreen.tsx', ['header', 'scrollContent', 'footer']],
  ['CoachInboxV2.tsx', ['header', 'searchContainer', 'listContent']],
  ['MessagesScreen.tsx', ['header', 'searchContainer', 'listContent']],
  ['ClientMessagesScreen.tsx', ['chatHeader', 'chatList', 'inputBar', 'errorBanner']],
  ['RiskBoardScreen.tsx', ['header', 'filterRow', 'listContent']],
  ['client-detail/styles.ts', ['header', 'tabRow', 'scrollContent', 'planModalHeader', 'planModalContent']],
];
const block = (src: string, key: string) => {
  const m = src.match(new RegExp(`\\b${key}:\\s*\\{([^{}]*)\\}`));
  if (!m) throw new Error(`no ${key} block`);
  return m[1];
};

describe('page gutters are layout.gutter (24 pt), never 16 or 20', () => {
  it.each(GUTTERS)('%s', (file, keys) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const key of keys) {
      const b = block(src, key);
      expect(`${key}: ${b}`).toMatch(/paddingHorizontal:\s*layout\.gutter/);
      expect(`${key}: ${b}`).not.toMatch(/\bpadding:\s*\d/);
    }
  });

  it('client detail skeleton rows and the Business profile dialog use the gutter token', () => {
    const detail = fs.readFileSync(path.join(ROOT, 'ClientDetailScreen.tsx'), 'utf8');
    expect(detail).not.toMatch(/paddingHorizontal:\s*16\b/);
    const team = fs.readFileSync(path.join(ROOT, 'CoachTeamProfileScreen.tsx'), 'utf8');
    expect(block(team, 'modalOverlay')).toMatch(/padding:\s*layout\.gutter/);
  });

  it('the three pushed screens show Back only when there is a screen to go back to', () => {
    for (const file of ['RiskBoardScreen.tsx', 'SubCoachDetailScreen.tsx', 'CoachTeamProfileScreen.tsx']) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(src).toMatch(/const back = navigation\.canGoBack\(\) \?/);
      expect(src).toContain('name="arrow-back" size={24}');
    }
  });
});
