/**
 * Macros screen in the lighter first week (clinic contract v1 addition 8):
 * the backend's macro_display_mode on GET /me/macros/current decides whether
 * carbs, fats and fiber show. Absent field: the existing four cells.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { typography } from '../../../theme/tokens';

let mockData: Record<string, unknown> | null = null;
let mockCoach = { id: 'c1', name: 'Sam Lee' };
let mockLog: { data: Record<string, number> | null; isError: boolean; isLoading: boolean } = {
  data: null, isError: false, isLoading: false,
};
const mockRefetch = jest.fn();
const mockLogRefetch = jest.fn();
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(actual),
    RefreshControl: { enumerable: true, value: ({ onRefresh }: { onRefresh: () => void }) =>
      jest.requireActual('react').createElement(actual.View, { accessible: true, accessibilityLabel: 'Refresh macros', onRefresh }) },
  });
});
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mockCoach }) }));
jest.mock('../../../hooks/useApi', () => ({ useTodayLog: () => ({ ...mockLog, refetch: mockLogRefetch }) }));
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({
    data: mockData,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
    isRefetching: false,
  }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', email: 'a@b.c' }),
}));

import ClientMacrosScreen from '../ClientMacrosScreen';
import { __resetMacroDisplayStoreForTests } from '../../../macros/macroDisplayStore';

const TARGET = {
  id: 't1',
  client_id: 'u1',
  coach_id: 'c1',
  calories_kcal: 1789,
  protein_g: 150,
  carbs_g: 185,
  fats_g: 50,
  fiber_g: 25,
  notes: null,
  effective_from: '2026-10-01T00:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
  archived_at: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetMacroDisplayStoreForTests();
  mockCoach = { id: 'c1', name: 'Sam Lee' };
  mockLog = { data: { total_calories: 600, total_protein_g: 50, total_carbs_g: 60, total_fat_g: 20 }, isError: false, isLoading: false };
  jest.clearAllMocks();
});

describe('ClientMacrosScreen display mode', () => {
  it('shows every target when the backend sends no mode', async () => {
    mockData = { ...TARGET };
    await render(<ClientMacrosScreen />);
    expect(screen.getByText('1789')).toBeTruthy();
    for (const label of ['Protein', 'Carbs', 'Fats', 'Fiber']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByTestId('macros-simple-note')).toBeNull();
  });

  it('shows calories and protein only while simple, with the quiet note', async () => {
    mockData = { ...TARGET, macro_display_mode: 'simple', simple_until: '2999-01-01' };
    await render(<ClientMacrosScreen />);
    expect(await screen.findByTestId('macros-simple-note')).toBeTruthy();
    expect(screen.getByText('1789')).toBeTruthy();
    expect(screen.getByText('Protein')).toBeTruthy();
    expect(screen.getByText('50g eaten / 150g target')).toBeTruthy();
    expect(screen.queryByText('Carbs')).toBeNull();
    expect(screen.queryByText('Fats')).toBeNull();
    expect(screen.queryByText('185g')).toBeNull();
  });

  it('returns to every target once simple_until has passed', async () => {
    mockData = { ...TARGET, macro_display_mode: 'simple', simple_until: '2000-01-01' };
    await render(<ClientMacrosScreen />);
    expect(screen.getByText('Carbs')).toBeTruthy();
    expect(screen.queryByTestId('macros-simple-note')).toBeNull();
  });

  it('uses the calorie hero and real consumed totals in three quiet rows, preserving fiber, notes and date', async () => {
    mockData = { ...TARGET, notes: 'Keep meals regular.' };
    await render(<ClientMacrosScreen />);
    expect(screen.getByText('1789')).toHaveStyle({ fontFamily: typography.display.fontFamily, fontVariant: ['tabular-nums'] });
    expect(screen.getByText('600 kcal eaten today')).toBeTruthy();
    for (const label of ['Protein', 'Carbs', 'Fats']) expect(screen.getByTestId(`quiet-bar-${label}`)).toBeTruthy();
    expect(screen.getByText('50g eaten / 150g target')).toBeTruthy();
    expect(screen.getByText('25g')).toBeTruthy();
    expect(screen.getByText('Keep meals regular.')).toBeTruthy();
    expect(screen.getByText('Set by Sam')).toBeTruthy();
    expect(screen.getByText(/^Effective /)).toBeTruthy();
  });

  it('never substitutes zero consumption when the food log is unavailable', async () => {
    mockData = { ...TARGET };
    mockLog = { data: null, isError: true, isLoading: false };
    const s = await render(<ClientMacrosScreen />);
    expect(screen.getByText("Today's food totals did not load. Pull to retry.")).toBeTruthy();
    expect(screen.getByText('150g target')).toBeTruthy();
    expect(screen.queryByText(/0g eaten|0 kcal eaten/)).toBeNull();
    await fireEvent(s.getByLabelText('Refresh macros'), 'refresh');
    expect(mockRefetch).toHaveBeenCalled();
    expect(mockLogRefetch).toHaveBeenCalled();
  });

  it('keeps attribution and the empty state neutral when no author is known', async () => {
    mockData = { ...TARGET, coach_id: null, notes: 'Profile target', effective_from: null };
    const s = await render(<ClientMacrosScreen />);
    expect(screen.getByText('Your target')).toBeTruthy();
    expect(screen.getByText('Target note')).toBeTruthy();
    expect(screen.queryByText(/Set by|Effective /)).toBeNull();
    mockData = null;
    await s.rerender(<ClientMacrosScreen />);
    expect(screen.getByText('No targets yet')).toBeTruthy();
    expect(screen.getByText('Daily targets appear here when set.')).toBeTruthy();
    expect(screen.queryByText(/Your coach has not/)).toBeNull();
  });

  it('does not attribute a previous coach target to the current coach', async () => {
    mockData = { ...TARGET, notes: 'Recorded note.' };
    mockCoach = { id: 'c2', name: 'Taylor Reed' };
    await render(<ClientMacrosScreen />);
    expect(screen.getByText('Your target')).toBeTruthy();
    expect(screen.getByText('Target note')).toBeTruthy();
    expect(screen.queryByText(/Set by/)).toBeNull();
  });

  it('says over target in words and distinguishes loading totals from zero', async () => {
    mockData = { ...TARGET };
    mockLog.data = { total_protein_g: 175, total_carbs_g: 200, total_fat_g: 55 };
    const s = await render(<ClientMacrosScreen />);
    expect(screen.getByText('175g eaten / 150g target · 25g over target')).toBeTruthy();
    mockLog = { data: null, isError: false, isLoading: true };
    await s.rerender(<ClientMacrosScreen />);
    expect(screen.getByText("Loading today's food totals...")).toBeTruthy();
    expect(screen.getByText('150g target')).toBeTruthy();
    expect(screen.queryByText(/0g eaten/)).toBeNull();
  });
});
