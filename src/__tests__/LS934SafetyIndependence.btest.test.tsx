/** Independent reviewer probe: a successful safety read must survive unrelated roster failure. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CoachHomeV11 from '../screens/coach/home-v11/CoachHomeV11';
import { needsYouAreas } from '../utils/coach/needsYou';
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
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: { lightImpact: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: false } }));

it('keeps the known safety card and its list destination reachable when roster fails', async () => {
  const alert = { alert_id: 'safety', alert_type: 'roman_crisis_reply' as const, client_id: 'a', client_name: 'Avery', message: 'Safety', dismissed_at: null, created_at: '2026-11-05T10:00:00Z' };
  mockHook.mockReturnValue({
    data: {
      overview: { roster_size: 1, active_today: 0, check_in_rate_7day: 0, open_alerts: 1, at_risk_count: 0, win_streak_count: 0, unread_messages: 0, pending_actions: 0 },
      home: null, overviewFailed: false, refreshing: false, needs: [],
      areas: needsYouAreas([], {}, [alert]), alertsState: 'ok', rosterState: 'error',
      reachOuts: [], steady: { count: 0, loggedToday: null }, ltv: null,
      month: { kind: 'error' }, payout: null, unreadNotifications: 0, draftsWaiting: 0,
      draftKinds: { workouts: 0, mealPlans: 0, nudges: 0, workoutChanges: 0 }, draftsState: 'ok',
      draftsRetrying: false, now: new Date('2026-11-05T12:00:00Z'),
    },
    blockList: { blockedIds: [], known: true, loading: false, error: null, refresh: jest.fn() },
    reload: jest.fn(), retryMonth: jest.fn(), retryRoster: jest.fn(), retryDrafts: jest.fn(), focused: true,
  });
  const open = jest.fn();
  const go = jest.fn();
  const view = await render(<CoachHomeV11 onOpenNeedsYou={open} onOpenClients={go} onOpenStreaks={go} onOpenMoney={go} onOpenDrafts={go} onOpenNotifications={go} onOpenSettings={go} />);
  expect(view.queryByTestId('home-needs-safety')).not.toBeNull();
  await fireEvent.press(view.getByTestId('home-needs'));
  expect(open).toHaveBeenCalled();
});
