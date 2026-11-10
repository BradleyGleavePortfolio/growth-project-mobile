/** Independent LS-934R2 read-state B-TESTs, exact base 03484a39. No product code changed. */
import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import { useCoachStore } from '../store/coachStore';
import { useCoachHomeV11 } from '../screens/coach/home-v11/useCoachHomeV11';
import { coachHomeSources } from '../screens/coach/command-center/coachHomeSources';
import ClientLookupScreen from '../screens/coach/lookup/ClientLookupScreen';

const mockGetClients = jest.fn();
const mockUnread = jest.fn();
const mockQueue = jest.fn();
const mockDrafts = jest.fn();
const mockNavigate = jest.fn();
const mockBlocked = new Set<string>();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
  useFocusEffect: () => undefined,
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const Icon = ({ name }: { name: string }) => R.createElement(Text, null, name);
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon, MaterialCommunityIcons: Icon };
});
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: () => Promise.resolve({ data: {} }) },
  coachApi: {
    getClients: (...a: unknown[]) => mockGetClients(...a),
    getUnreadCounts: () => mockUnread(),
    getBillingSummary: () => Promise.resolve({ data: {} }),
    sendNudge: jest.fn(),
  },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => mockDrafts() }));
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({
  readOpenAlerts: () => mockQueue(),
  coachHomeSources: {
    actionQueue: () => mockQueue(),
    pathChangeDrafts: () => Promise.resolve([]),
    atRisk: () => Promise.resolve([]),
    ltv: () => Promise.resolve({}),
    nextPayout: () => Promise.resolve(null),
    monthSoFar: () => Promise.resolve({ totals: { netCents: 0 } }),
  },
}));
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => Promise.resolve(0) }));
jest.mock('../screens/coach/home-v11/blockList', () => ({
  needsYouReason: jest.requireActual('../screens/coach/home-v11/blockList').needsYouReason,
  useCoachBlockList: () => ({ blockedIds: [...mockBlocked], known: true, loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: false } }));
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn(), lightImpact: jest.fn() } }));
jest.mock('../screens/coach/lookup/ClientPeekSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/coach/client-detail/NudgeModal', () => ({ NudgeModal: () => null }));
jest.mock('../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const today = () => new Date().toISOString().slice(0, 10);
const wire = () => ({
  id: 'c1', name: 'Steady Client', role: 'student',
  coach_id: 'coach-1', archived_at: null, created_at: '2026-01-01T00:00:00Z',
  activity: { last_active_on: today(), check_ins_to_review: 0 },
});
const navigation = { navigate: mockNavigate, setParams: jest.fn(), isFocused: () => true, addListener: () => () => undefined, getParent: () => undefined };
const mountList = () => render(<ClientLookupScreen navigation={navigation as never} route={{ params: { view: 'needs' } } as never} />);
beforeEach(() => {
  jest.clearAllMocks();
  useCoachStore.getState().reset();
  mockGetClients.mockImplementation((status: string) => Promise.resolve({ data: status === 'archived' ? [] : [wire()] }));
  mockQueue.mockResolvedValue([]);
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: {} } });
  mockDrafts.mockReturnValue({ data: { drafts: [] }, isError: false, refetch: jest.fn() });
});

it('control: a verified empty list may say nobody needs you', async () => {
  const v = await mountList();
  await waitFor(() => expect(v.queryByText('Nobody needs you right now.')).toBeTruthy());
});

it('B1: a failed first unread-count read is unknown, never a verified nobody-needs-you result', async () => {
  mockUnread.mockRejectedValue(new Error('Network Error'));
  const v = await mountList();
  await waitFor(() => expect(mockUnread).toHaveBeenCalled());
  await waitFor(() => expect(v.queryByText('Loading clients')).toBeNull());
  await act(async () => { await Promise.resolve(); });
  expect(v.queryByText('Nobody needs you right now.')).toBeNull();
});

it('B1: cached zero drafts plus a failed stream-two re-read is an error, not verified zero', async () => {
  mockDrafts.mockReturnValue({ data: { drafts: [] }, isError: true, error: new Error('Network Error'), refetch: jest.fn() });
  const overview = async () => ({ overview: { roster_count: 1 }, home: null, source: 'legacy' }) as never;
  const { result } = await renderHook(() => useCoachHomeV11(coachHomeSources, overview, true));
  await waitFor(() => expect(result.current.data.rosterState).toBe('ok'));
  expect(result.current.data.draftsState).toBe('error');
});
