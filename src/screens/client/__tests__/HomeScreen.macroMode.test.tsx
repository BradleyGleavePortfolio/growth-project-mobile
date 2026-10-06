/**
 * Home number grid in the lighter first week (clinic contract v1 addition
 * 8): calories and protein (plus water) while simple; the existing protein,
 * carbs, fat and water grid otherwise. The one-time Roman card appears on
 * Home once the simple week has ended.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    id: 'u1',
    email: 'a@b.c',
    profile: { calorie_target: 1789, protein_target: 150, carbs_target: 185, fat_target: 50 },
  }),
}));
jest.mock('../../../store/clientStore', () => ({
  useClientStore: () => ({
    foodLogs: [],
    dailyTotals: { calories: 600, protein: 40, carbs: 70, fat: 20 },
    waterOz: 0,
    loadDayData: jest.fn(),
    loadProfile: jest.fn(),
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
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
import {
  __resetMacroDisplayStoreForTests,
  hydrateMacroDisplay,
  reportMacroDisplay,
} from '../../../macros/macroDisplayStore';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetMacroDisplayStoreForTests();
});

describe('HomeScreen macro display mode', () => {
  it('keeps the existing grid when the backend sends no mode', async () => {
    await render(<HomeScreen />);
    expect(await screen.findByTestId('home-number-grid')).toBeTruthy();
    for (const label of ['PROTEIN', 'CARBS', 'FAT', 'WATER']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('CALORIES')).toBeNull();
    expect(screen.queryByTestId('full-macros-intro-card')).toBeNull();
  });

  it('shows calories and protein only while simple', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: '2999-01-01' });
    await render(<HomeScreen />);
    expect(await screen.findByTestId('home-number-grid-simple')).toBeTruthy();
    expect(screen.getByText('CALORIES')).toBeTruthy();
    expect(screen.getByText('600')).toBeTruthy();
    expect(screen.getByText('of 1789 kcal')).toBeTruthy();
    expect(screen.getByText('PROTEIN')).toBeTruthy();
    expect(screen.queryByText('CARBS')).toBeNull();
    expect(screen.queryByText('FAT')).toBeNull();
  });

  it('after the simple week: full grid and the one-time Roman card', async () => {
    await hydrateMacroDisplay('u1');
    reportMacroDisplay({ macro_display_mode: 'simple', simple_until: '2000-01-01' });
    await render(<HomeScreen />);
    expect(await screen.findByTestId('home-number-grid')).toBeTruthy();
    expect(screen.getByText('CARBS')).toBeTruthy();
    expect(screen.getByTestId('full-macros-intro-card')).toBeTruthy();
    expect(screen.getByText(/185 grams of carbohydrate and 50 grams of fat a day/)).toBeTruthy();
  });
});
