/**
 * SWEEP-FOOD-LOG B2 (B-TEST, fails at 50ff9b2e). The Food tab (LogScreen.tsx:78) and Home (HomeScreen.tsx:251) take
 * the day's targets from useMacroTargets, which reads GET /me/macros/current once per signed-in account
 * (useMacroTargets.ts effect keyed on the user id). Both tabs stay mounted for the life of the app, so a target her
 * coach changes is not shown on the Food day's "kcal left" line, the Food log's summary or Home until the app is
 * killed and started again; the Macros page (its own query) already shows the new target. When the app comes back
 * to the foreground the targets must be read again.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockCurrentForSelf = jest.fn();
jest.mock('../useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1' }) }));
jest.mock('../../api/macrosApi', () => ({
  macrosApi: { currentForSelf: (...args: unknown[]) => mockCurrentForSelf(...args) },
}));

const appStateHandlers: Array<(s: AppStateStatus) => void> = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
  appStateHandlers.push(handler as (s: AppStateStatus) => void);
  return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
});

import { useMacroTargets } from '../useMacroTargets';

const target = (calories: number) => ({
  data: {
    id: 'mt', client_id: 'client-1', coach_id: 'coach-1', calories_kcal: calories, protein_g: 150, carbs_g: 200,
    fats_g: 60, fiber_g: null, notes: null, effective_from: '', created_at: '', archived_at: null,
  },
});

describe('SWEEP-FOOD-LOG B2: a target her coach changes reaches the Food tab', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCurrentForSelf.mockReset();
    appStateHandlers.length = 0;
  });

  it('reads the targets again when the app returns to the foreground', async () => {
    mockCurrentForSelf.mockResolvedValue(target(2000));
    const { result } = await renderHook(() => useMacroTargets());
    await waitFor(() => expect(result.current?.calories).toBe(2000));

    // The coach lowers her target; she leaves the app and comes back to it later the same day.
    mockCurrentForSelf.mockResolvedValue(target(1800));
    await act(async () => {
      appStateHandlers.forEach((h) => h('background'));
      appStateHandlers.forEach((h) => h('active'));
    });

    await waitFor(() => expect(result.current?.calories).toBe(1800));
  });
});
