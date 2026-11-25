/**
 * LO-981 B1 (m#981 @ 26c847b9): GOAL-927-M PLAN row "2200 -> 2,100" (RULING 10, K5 C_macros) is CLOSE in the PLAN
 * but the build keeps main's ungrouped digits. K5 sets the day's number and the eaten line with a thousands comma.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';

jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { id: 'c1', name: 'Sam Lee' } }) }));
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: () => ({ data: { total_calories: 2380, total_protein_g: 120, total_carbs_g: 200, total_fat_g: 60 },
    isError: false, isLoading: false, refetch: jest.fn() }),
}));
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({
    data: { id: 't1', client_id: 'u1', coach_id: 'c1', calories_kcal: 2200, protein_g: 160, carbs_g: 220, fats_g: 70,
      fiber_g: 30, notes: null, effective_from: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', archived_at: null },
    isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false,
  }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1' }) }));

import ClientMacrosScreen from '../ClientMacrosScreen';
import { __resetMacroDisplayStoreForTests } from '../../../macros/macroDisplayStore';

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetMacroDisplayStoreForTests();
});

it('LO-981 B1: the day target and the eaten line group their digits as K5 does ("2,200", "2,380 kcal eaten today")', async () => {
  await render(<ClientMacrosScreen />);
  expect(screen.getByText('2,200')).toBeTruthy();
  expect(screen.getByText('2,380 kcal eaten today')).toBeTruthy();
});
