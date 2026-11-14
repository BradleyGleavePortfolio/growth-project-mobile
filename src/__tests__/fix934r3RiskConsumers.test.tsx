/** FIX-934R3 B1: the actual Home lead and Attention rows share stable safety/red-risk priority. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CoachHomeV11 from '../screens/coach/home-v11/CoachHomeV11';
import NeedsYouList from '../screens/coach/lookup/NeedsYouList';
import type { ActionQueueItem } from '../services/commandCenterApi';
import { needsYouAreas, openAlerts } from '../utils/coach/needsYou';

const mockHook = jest.fn();
jest.mock('../screens/coach/home-v11/useCoachHomeV11', () => ({ useCoachHomeV11: () => mockHook() }));
jest.mock('../ui', () => ({ useScreenInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../screens/coach/home-v11/planEndedData', () => ({
  usePlanEnded: () => ({ page: { total: 0, items: [], nextCursor: null }, failed: false, reload: jest.fn(), refreshing: false, more: jest.fn(), loadingMore: false, reset: jest.fn(), blocked: false }),
}));
jest.mock('../screens/coach/home-v11/PlanEnded', () => ({ PlanEndedHomeRow: () => null, PlanEndedList: () => null }));
jest.mock('../screens/coach/home-v11/WinTurn', () => ({
  useWinTurn: () => ({ turn: 0, still: true, calm: true }), useWinFade: () => undefined, WinTurn: () => null,
}));
jest.mock('../screens/coach/home-v11/DraftSheets', () => ({
  HomeSheet: () => null, reachOutAsk: () => ({ heading: '', body: '', label: '', submit: async () => undefined }),
}));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { lightImpact: jest.fn(), softImpact: jest.fn(), selection: jest.fn() },
}));
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));

const alert = (id: string, type: string, dismissed_at: string | null = null): ActionQueueItem => ({
  alert_id: id, alert_type: type as ActionQueueItem['alert_type'],
  client_id: `c-${id}`, client_name: `Client ${id}`, message: 'An open coach alert.',
  created_at: '2026-11-06T12:00:00Z', dismissed_at,
});
const cases = ['risk_red_transition', 'high_churn_risk', 'risk_red'].flatMap((riskType) =>
  [false, true].map((safety) => ({ name: `${riskType}, safety ${safety}`, riskType, safety })),
);

it.each(cases)('$name: Home lead and actual Attention row order agree', async ({ riskType, safety }) => {
  // Deliberately not timestamp-sorted: the server's order, including ties, is authoritative within a class.
  const items = [
    alert('ordinary-first', 'missed_checkins'), alert('risk-first', riskType),
    alert('ordinary-second', 'weight_not_logged'), alert('risk-second', 'high_churn_risk'),
    alert('dismissed-risk', riskType, '2026-11-06T13:00:00Z'),
    ...(safety ? [alert('safety-first', 'roman_urgent_reply'), alert('safety-second', 'roman_crisis_reply')] : []),
  ];
  const original = [...items];
  const expected = [
    ...(safety ? ['safety-first', 'safety-second'] : []),
    'risk-first', 'risk-second', 'ordinary-first', 'ordinary-second',
  ];
  const areas = needsYouAreas([], {}, items);
  expect(openAlerts(items).map((row) => row.alert_id)).toEqual(expected);
  expect(items).toEqual(original);
  expect(areas.total).toBe(expected.length);
  mockHook.mockReturnValue({
    data: {
      overview: { roster_size: 1, active_today: 0, check_in_rate_7day: 0, open_alerts: expected.length, at_risk_count: 0, win_streak_count: 0, unread_messages: 0, pending_actions: 0 },
      home: null, overviewFailed: false, refreshing: false, needs: [], areas,
      alertsState: 'ok', rosterState: 'ok', reachOuts: [], steady: { count: 1, loggedToday: null }, ltv: null,
      month: { kind: 'error' }, payout: null, unreadNotifications: 0, draftsWaiting: 0,
      draftKinds: { workouts: 0, mealPlans: 0, nudges: 0, workoutChanges: 0 }, draftsState: 'ok',
      draftsRetrying: false, now: new Date('2026-11-06T14:00:00Z'),
    },
    blockList: { blockedIds: [], known: true, loading: false, error: null, refresh: jest.fn() },
    reload: jest.fn(), retryMonth: jest.fn(), retryRoster: jest.fn(), retryDrafts: jest.fn(), focused: true,
  });
  const go = jest.fn();
  const home = await render(<CoachHomeV11 onOpenNeedsYou={go} onOpenClients={go} onOpenStreaks={go}
    onOpenMoney={go} onOpenDrafts={go} onOpenNotifications={go} onOpenSettings={go} />);
  expect(home.getByTestId('home-needs').props.accessibilityLabel)
    .toContain(`Needs you, ${expected.length}. Client ${expected[0]},`);
  await fireEvent.press(home.getByTestId('home-needs'));
  expect(go).toHaveBeenCalledTimes(1);
  await home.unmount();

  const open = jest.fn();
  const list = await render(<NeedsYouList areas={areas} rosterCount={1} loading={false} error={null}
    alertsFailed={false} refreshing={false} now={new Date('2026-11-06T14:00:00Z')}
    onBack={go} onRefresh={go} onRetry={go} onOpenSafety={open} onOpenAlert={open}
    onOpenClient={go} onAction={go} />);
  expect(list.getAllByTestId(/^needs-(safety|alert)-/).map((row) =>
    row.props.testID.replace(/^needs-(safety|alert)-/, ''))).toEqual(expected);
  await fireEvent.press(list.getByTestId(`needs-${safety ? 'safety' : 'alert'}-${expected[0]}`));
  expect(open).toHaveBeenCalledWith(items.find((row) => row.alert_id === expected[0]));
});
