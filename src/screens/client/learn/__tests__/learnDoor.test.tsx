// LEARN-A L2 (flag learnHub): the You list's Learn door shows only once the coach has written something,
// and the guidelines page shows the coach's text with no lock page.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api, { coachApi, lessonsApi } from '../../../../services/api';
import MoreScreen from '../../MoreScreen';
import YouScreen from '../../YouScreen';
import LearnGuidelinesScreen from '../LearnGuidelinesScreen';
import { GUIDELINES_PLAN_TITLE } from '../learnData';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn(), getState: jest.fn() };
let mockUser: { id: string; coach_id?: string | null } = { id: 'me', coach_id: 'c1' };
let mockFocused = true;
let mockOnline = true;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav, useIsFocused: () => mockFocused, useFocusEffect: () => undefined,
}));
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ online: mockOnline }), isEffectivelyOnline: (n: { online: boolean }) => n.online,
}));
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: new Proxy({}, { get: (_t, k: string) => k === 'learnHub' }),
}));
jest.mock('../../../../config/healthConnect', () => ({ isAndroidHealthConnectEnabled: () => false }));
jest.mock('../../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../../components/tutorial/TutorialTarget', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  coachApi: { getMyGuidelines: jest.fn() },
  lessonsApi: { getAll: jest.fn(), complete: jest.fn() },
}));
// The You home (C9-S1) carries the same Learn row in its Support group.
jest.mock('../../../../services/queryClient', () => ({ queryClient: new (jest.requireActual('@tanstack/react-query').QueryClient)() }));
jest.mock('../../../../lib/packagePayment', () => ({
  ...jest.requireActual('../../../../lib/packagePayment'), listClientPlans: () => Promise.resolve([]),
}));
jest.mock('../../../../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ data: [] }) }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../../../../components/coachless/CoachCodeSheet', () => () => null);
jest.mock('../../../../services/authActions', () => ({ prepareSignOutConfirm: jest.fn(), signOut: jest.fn() }));
jest.mock('../../../../ui/charts', () => ({ SegmentedRing: () => null }));

const year = new Date().getFullYear();
const GUIDE = { description: '# Food\n- Protein at every meal, about a palm.', updated_at: `${year}-10-12T12:00:00Z` };
const LESSON = { id: 'l1', title: 'How Sam builds your week', description: 'Short read.', completions: [] };
const PLAN = { response: { status: 402, data: { error: 'CLIENT_ENTITLEMENT_REQUIRED' } } };
const lessons = jest.mocked(lessonsApi.getAll);
const guidelines = jest.mocked(coachApi.getMyGuidelines);
const answer = (rows: unknown[], guide: unknown) => {
  lessons.mockImplementation(() => Promise.resolve({ data: rows }) as never);
  guidelines.mockImplementation(() => (guide === PLAN ? Promise.reject(PLAN) : Promise.resolve({ data: guide })) as never);
};

async function show(Comp: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const tree = () => (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } }}>
      <QueryClientProvider client={client}><Comp /></QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(tree());
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return () => view.rerender(tree());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'me', coach_id: 'c1' }; mockFocused = true; mockOnline = true;
  mockNav.getParent.mockReturnValue(null);
  mockNav.getState.mockReturnValue({ index: 1, routes: [{ name: 'Learn' }, { name: 'CoachGuidelines' }] });
  jest.mocked(api.get).mockImplementation(() => Promise.resolve({ data: { name: 'Sam Lee' } }) as never);
  answer([LESSON], GUIDE);
});

describe('Learn door on the You list (#LEARN-DOOR op 2, #LEARN-COACHLESS op 1)', () => {
  it.each([
    ['guidelines and lessons', [LESSON], GUIDE, true],
    ['guidelines only', [], GUIDE, true],
    ['lessons only, with an older server answering 402', [LESSON], PLAN, true],
    ['nothing written', [], null, false],
    ['only an older server answering 402', [], PLAN, false],
  ])('%s: the row shows = %s', async (_label, rows, guide, shows) => {
    answer(rows, guide);
    await show(MoreScreen);
    expect(screen.queryByLabelText('Learn') !== null).toBe(shows);
    if (shows) {
      await fireEvent.press(screen.getByLabelText('Learn'));
      expect(mockNav.navigate).toHaveBeenCalledWith('Learn');
    }
  });

  it.each([['comes back into view', 'focus'], ['is back online after a failed read', 'online']])(
    'hidden, then the coach writes: the row appears when You %s, without a restart', async (_label, how) => {
      answer([], null);
      if (how === 'online') { mockOnline = false; lessons.mockImplementation(() => Promise.reject(new Error('Network Error')) as never); }
      const again = await show(MoreScreen);
      expect(screen.queryByLabelText('Learn')).toBeNull();
      expect(lessons).toHaveBeenCalledTimes(1);
      if (how === 'focus') { mockFocused = false; await again(); }
      answer([LESSON], GUIDE);
      if (how === 'focus') mockFocused = true; else mockOnline = true;
      await again();
      expect(await screen.findByLabelText('Learn')).toBeTruthy();
    });

  it.each([
    ['the coach has written something', [LESSON], GUIDE, 'c1', true],
    ['nothing written', [], null, 'c1', false],
    ['no coach', [LESSON], GUIDE, null, false],
  ])('the You home (C9-S1) Support group: %s, the Learn row shows = %s', async (_label, rows, guide, coach, shows) => {
    mockUser = { id: 'me', coach_id: coach };
    answer(rows, guide);
    await show(YouScreen);
    expect(screen.getByTestId('you-row-Settings')).toBeTruthy();
    expect(screen.queryByTestId('you-row-Learn') !== null).toBe(shows);
    if (shows) {
      await fireEvent.press(screen.getByTestId('you-row-Learn'));
      expect(mockNav.navigate).toHaveBeenCalledWith('Learn', undefined);
    }
  });

  it('without a coach the row stays hidden and nothing is read', async () => {
    mockUser = { id: 'me', coach_id: null };
    await show(MoreScreen);
    expect(screen.queryByLabelText('Learn')).toBeNull();
    expect(lessons).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });
});

describe('Your guidelines page', () => {
  it("shows the coach's text as written, with Message {coach} as a text action", async () => {
    const parent = { navigate: jest.fn() };
    mockNav.getParent.mockReturnValue(parent);
    await show(LearnGuidelinesScreen);
    expect(screen.getByText('From Sam · updated October 12')).toBeTruthy();
    expect(screen.getByText('Your guidelines')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Food' })).toBeTruthy();
    expect(screen.getByText('Protein at every meal, about a palm.')).toBeTruthy();
    expect(screen.getByText('Learn')).toBeTruthy();
    expect(guidelines).toHaveBeenCalledWith({ quietPaywall: true });
    await fireEvent.press(screen.getByText('Message Sam'));
    expect(parent.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages', initial: false });
  });

  it("says an older server's 402 in today's words, with no lock page and no plans button", async () => {
    answer([], PLAN);
    await show(LearnGuidelinesScreen);
    expect(screen.getByText(GUIDELINES_PLAN_TITLE)).toBeTruthy();
    expect(screen.queryByText('View plans')).toBeNull();
    expect(screen.getByText('Message Sam')).toBeTruthy();
  });

  it('a failed read is one sentence and Try again; the connection is named only without an answer', async () => {
    guidelines.mockImplementationOnce(() => Promise.reject({ response: { status: 500 } }));
    await show(LearnGuidelinesScreen);
    expect(screen.getByText('Guidelines did not load.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Protein at every meal, about a palm.')).toBeTruthy();
    await screen.unmount();
    guidelines.mockImplementationOnce(() => Promise.reject({ message: 'Network Error' }));
    await show(LearnGuidelinesScreen);
    expect(screen.getByText('Guidelines did not load. Check the connection and try again.')).toBeTruthy();
  });

  it('with nothing written says so; without a coach there is no thread action', async () => {
    answer([], null);
    await show(LearnGuidelinesScreen);
    expect(screen.getByText('Nothing from Sam yet')).toBeTruthy();
    await screen.unmount();
    mockUser = { id: 'me', coach_id: null };
    await show(LearnGuidelinesScreen);
    expect(screen.getByText('Nothing from your coach yet')).toBeTruthy();
    expect(screen.queryByText('Message your coach')).toBeNull();
  });
});
