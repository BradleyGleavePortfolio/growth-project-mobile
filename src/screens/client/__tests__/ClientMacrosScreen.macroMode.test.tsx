/**
 * Macros screen in the lighter first week (clinic contract v1 addition 8):
 * the backend's macro_display_mode on GET /me/macros/current decides whether
 * carbs, fats and fiber show. Absent field: the existing four cells.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';

let mockData: Record<string, unknown> | null = null;
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({
    data: mockData,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
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
    expect(screen.getByText('150g')).toBeTruthy();
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
});
