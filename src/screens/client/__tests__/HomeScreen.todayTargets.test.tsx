// Home: server targets (as on the Food Log), and always today's numbers.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import { getTodayString } from '../../../utils/date';

const mockDayState = {
  foodLogs: [],
  dailyTotals: { calories: 600, protein: 40, carbs: 70, fat: 20 },
  waterOz: 0,
  selectedDate: '2026-10-01',
  isLoading: false,
  loadError: null as string | null,
  loadDayData: jest.fn().mockResolvedValue(undefined),
  loadProfile: jest.fn().mockResolvedValue(undefined),
};
let mockServerTargets: { calories: number; protein: number; carbs: number; fat: number } | null = null;

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    id: 'u1',
    email: 'a@b.c',
    profile: { calorie_target: 1789, protein_target: 150, carbs_target: 185, fat_target: 50 },
  }),
}));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => mockServerTargets }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockDayState }));
jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    // Run the focus callback like a screen that just gained focus.
    useFocusEffect: (cb: () => void) => ReactActual.useEffect(cb, [cb]),
  };
});
jest.mock('../../../services/api', () => ({
  workoutApi: { getAll: () => Promise.resolve({ data: [] }) },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../../../components/PendingInviteBanner', () => () => null);
jest.mock('../../../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../../../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../../../components/coachless/CoachlessHomeSlot', () => () => null);

import HomeScreen from '../HomeScreen';
import { __resetMacroDisplayStoreForTests } from '../../../macros/macroDisplayStore';

beforeEach(async () => {
  jest.clearAllMocks();
  mockServerTargets = null;
  mockDayState.selectedDate = '2026-10-01';
  await AsyncStorage.clear();
  __resetMacroDisplayStoreForTests();
});

describe('Home food numbers', () => {
  it('shows the server targets, not the numbers cached on the phone at onboarding', async () => {
    mockServerTargets = { calories: 2400, protein: 190, carbs: 260, fat: 80 };
    await render(<HomeScreen />);
    expect(await screen.findByText('of 190g')).toBeTruthy();
    expect(screen.getByText('of 260g')).toBeTruthy();
    expect(screen.getByText('of 80g')).toBeTruthy();
    expect(screen.queryByText('of 150g')).toBeNull();
  });

  it("reloads today when the Food Log was left on an earlier day", async () => {
    await render(<HomeScreen />);
    const today = getTodayString();
    expect(mockDayState.loadDayData).toHaveBeenCalledWith('u1', today);
    expect(mockDayState.loadDayData.mock.calls.every((c: unknown[]) => c[1] === today)).toBe(true);
    expect(mockDayState.loadDayData.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not reload again on focus when the store already holds today', async () => {
    mockDayState.selectedDate = getTodayString();
    await render(<HomeScreen />);
    expect(mockDayState.loadDayData).toHaveBeenCalledTimes(1);
    expect(mockDayState.loadDayData).toHaveBeenCalledWith('u1', getTodayString());
  });
});
