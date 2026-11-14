/** FIX-934R2: every counted read must answer before an empty result or total is asserted. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CoachHomeV11 from '../screens/coach/home-v11/CoachHomeV11';
import NeedsYouList from '../screens/coach/lookup/NeedsYouList';
import { needsYouAreas } from '../utils/coach/needsYou';
import type { ActionQueueItem } from '../services/commandCenterApi';

const mockHook = jest.fn();
jest.mock('../screens/coach/home-v11/useCoachHomeV11', () => ({ useCoachHomeV11: () => mockHook() }));
jest.mock('../ui', () => ({ useScreenInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../screens/coach/home-v11/planEndedData', () => ({
  usePlanEnded: () => ({ page: null, reload: jest.fn() }),
}));
jest.mock('../screens/coach/home-v11/PlanEnded', () => ({ PlanEndedHomeRow: () => null, PlanEndedList: () => null }));
jest.mock('../screens/coach/home-v11/WinTurn', () => ({
  useWinTurn: () => ({ turn: 0, still: true, calm: true }), useWinFade: () => undefined, WinTurn: () => null,
}));
jest.mock('../screens/coach/home-v11/DraftSheets', () => ({ HomeSheet: () => null, reachOutAsk: jest.fn() }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { lightImpact: jest.fn(), softImpact: jest.fn(), selection: jest.fn() },
}));
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: false } }));

const safety: ActionQueueItem = {
  alert_id: 's1', alert_type: 'roman_crisis_reply', client_id: 'a', client_name: 'Avery Cole',
  message: 'Safety', dismissed_at: null, created_at: '2026-11-05T10:00:00Z',
};
const now = new Date('2026-11-05T12:00:00Z');
const noop = () => undefined;

it.each([false, true])('Home: failed alert read, retained safety %s, no verified total or false clear', async (knownSafety) => {
  const reload = jest.fn();
  const open = jest.fn();
  mockHook.mockReturnValue({
    data: {
      overview: { roster_size: 1, active_today: 0, check_in_rate_7day: 0, open_alerts: 0, at_risk_count: 0, win_streak_count: 0, unread_messages: 0, pending_actions: 0 },
      home: null, overviewFailed: false, refreshing: false, needs: [],
      areas: needsYouAreas([], {}, knownSafety ? [safety] : null), alertsState: 'error', rosterState: 'ok',
      reachOuts: [], steady: { count: 1, loggedToday: 0 }, ltv: null, month: { kind: 'blocked' },
      payout: null, unreadNotifications: 0, draftsWaiting: 0,
      draftKinds: { workouts: 0, mealPlans: 0, nudges: 0, workoutChanges: 0 }, draftsState: 'ok',
      draftsRetrying: false, now,
    },
    blockList: { blockedIds: [], known: true, loading: false, error: null, refresh: noop },
    reload, retryMonth: noop, retryRoster: noop, retryDrafts: noop, focused: true,
  });
  const v = await render(<CoachHomeV11 onOpenNeedsYou={open} onOpenClients={noop} onOpenStreaks={noop}
    onOpenMoney={noop} onOpenDrafts={noop} onOpenNotifications={noop} onOpenSettings={noop} />);
  expect(v.queryByText('Nobody needs you right now.')).toBeNull();
  expect(v.queryByText(/^Needs you, \d/)).toBeNull();
  expect(v.getByTestId('home-needs-alerts-error')).toBeTruthy();
  await fireEvent.press(v.getByText('Try again'));
  expect(reload).toHaveBeenCalledWith(false);
  if (knownSafety) {
    await fireEvent.press(v.getByTestId('home-needs'));
    expect(open).toHaveBeenCalled();
  }
});

it.each([false, true])('Needs list: failed alert read, retained safety %s, held count and retry', async (knownSafety) => {
  const retry = jest.fn();
  const open = jest.fn();
  const v = await render(<NeedsYouList areas={needsYouAreas([], {}, knownSafety ? [safety] : null)}
    rosterCount={1} loading={false} error={null} alertsFailed refreshing={false} now={now}
    onBack={noop} onRefresh={noop} onRetry={retry} onOpenSafety={open}
    onOpenAlert={noop} onOpenClient={noop} onAction={noop} />);
  expect(v.queryByText('Nobody needs you right now.')).toBeNull();
  expect(v.getByTestId('needs-title').props.children).toBe('Needs you');
  expect(v.queryByTestId('needs-search')).toBeNull();
  expect(v.queryByTestId('needs-switch-attention')).toBeNull();
  await fireEvent.press(v.getByText('Try again'));
  expect(retry).toHaveBeenCalled();
  if (knownSafety) {
    await fireEvent.press(v.getByTestId('needs-safety-s1'));
    expect(open).toHaveBeenCalledWith(safety);
  }
});
