/** FIX-934R2: class siblings for first/retained reads, retry, and known safety above an unread failure. */
import React from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { useCoachStore } from '../store/coachStore';
import { useCoachHomeV11 } from '../screens/coach/home-v11/useCoachHomeV11';
import { coachHomeSources } from '../screens/coach/command-center/coachHomeSources';
import ClientLookupScreen from '../screens/coach/lookup/ClientLookupScreen';

const mockClients = jest.fn();
const mockUnread = jest.fn();
const mockQueue = jest.fn();
const mockDrafts = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true,
  useFocusEffect: () => undefined, useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: () => Promise.resolve({ data: {} }) },
  coachApi: {
    getClients: (...a: unknown[]) => mockClients(...a), getUnreadCounts: () => mockUnread(),
    getBillingSummary: () => Promise.resolve({ data: {} }), sendNudge: jest.fn(),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => mockDrafts() }));
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({
  readOpenAlerts: () => mockQueue(),
  coachHomeSources: {
    actionQueue: () => mockQueue(), pathChangeDrafts: () => Promise.resolve([]),
    atRisk: () => Promise.resolve([]), ltv: () => Promise.resolve({}), nextPayout: () => Promise.resolve(null),
    monthSoFar: () => Promise.resolve({ totals: { netCents: 0 } }),
  },
}));
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => Promise.resolve(0) }));
jest.mock('../screens/coach/home-v11/blockList', () => ({
  needsYouReason: jest.requireActual('../screens/coach/home-v11/blockList').needsYouReason,
  useCoachBlockList: () => ({ blockedIds: [], known: true, loading: false, error: null, refresh: mockRefresh }),
}));
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: false } }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), lightImpact: jest.fn() },
}));
jest.mock('../screens/coach/lookup/ClientPeekSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const wire = () => ({
  id: 'c1', name: 'Steady Client', role: 'student', coach_id: 'coach-1', archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  activity: { last_active_on: new Date().toISOString().slice(0, 10), check_ins_to_review: 0 },
});
const safety = {
  alert_id: 's1', alert_type: 'roman_crisis_reply', client_id: 'c1', client_name: 'Steady Client',
  message: 'Safety', dismissed_at: null, created_at: '2026-11-05T10:00:00Z',
};
const mount = () => render(<ClientLookupScreen
  navigation={{ navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true, addListener: () => () => undefined, getParent: () => undefined } as never}
  route={{ params: { view: 'needs' } } as never}
/>);
const overview = async () => ({ overview: { roster_count: 1 }, home: null, source: 'legacy' }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  useCoachStore.getState().reset();
  mockClients.mockResolvedValue({ data: [wire()] });
  mockQueue.mockResolvedValue([]);
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {} } });
  mockDrafts.mockReturnValue({ data: { drafts: [] }, isError: false, refetch: jest.fn() });
});

it('unread failure leaves a verified safety row available, then retry can verify empty', async () => {
  mockQueue.mockResolvedValue([safety]);
  mockUnread.mockRejectedValue(new Error('Network Error'));
  const v = await mount();
  await waitFor(() => expect(v.queryByTestId('needs-error')).toBeTruthy());
  expect(v.queryByTestId('needs-safety-s1')).toBeTruthy();
  expect(v.queryByText('Nobody needs you right now.')).toBeNull();
  expect(v.queryByTestId('needs-search')).toBeNull();
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {} } });
  mockQueue.mockResolvedValue([]);
  await fireEvent.press(v.getByTestId('needs-error-retry'));
  await waitFor(() => expect(v.queryByText('Nobody needs you right now.')).toBeTruthy());
});

it('a failed unread refresh after a successful zero is unknown, not cached verified zero', async () => {
  const v = await mount();
  await waitFor(() => expect(v.queryByText('Nobody needs you right now.')).toBeTruthy());
  mockUnread.mockRejectedValue(new Error('Network Error'));
  await act(async () => { await v.getByTestId('needs-list').props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(v.queryByTestId('needs-error')).toBeTruthy());
  expect(v.queryByText('Nobody needs you right now.')).toBeNull();
  expect(v.queryByTestId('needs-search')).toBeNull();
});

it('Home marks a retained roster failed when its latest read fails', async () => {
  const { result } = await renderHook(() => useCoachHomeV11(coachHomeSources, overview, true));
  await waitFor(() => expect(result.current.data.rosterState).toBe('ok'));
  mockUnread.mockRejectedValue(new Error('Network Error'));
  await act(async () => { await result.current.retryRoster(); });
  await waitFor(() => expect(result.current.data.rosterState).toBe('error'));
});

it.each([0, 2])('cached %i drafts never override a failed latest read', async (count) => {
  mockDrafts.mockReturnValue({
    data: { drafts: Array.from({ length: count }, (_, i) => ({ id: String(i), capability: 'draft.assign_workout' })) },
    isError: true, refetch: jest.fn(),
  });
  const { result } = await renderHook(() => useCoachHomeV11(coachHomeSources, overview, true));
  await waitFor(() => expect(result.current.data.rosterState).toBe('ok'));
  expect(result.current.data.draftsState).toBe('error');
  expect(result.current.data.draftsWaiting).toBe(count);
  expect(result.current.data.draftKinds.workouts).toBe(count);
});
