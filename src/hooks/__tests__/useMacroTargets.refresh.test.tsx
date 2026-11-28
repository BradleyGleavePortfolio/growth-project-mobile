/**
 * TARGETS-REFRESH-M (SWEEP-FOOD-LOG B2). The Food tab (LogScreen) and Home (HomeScreen) take her daily targets from
 * useMacroTargets and stay mounted for the life of the app. A target her coach changes must reach them when she comes
 * back to the app, and when she comes back to the screen, with one read per return (never a poll), while a failed read
 * keeps the last good target on screen with no error state. One account's read never paints for the next account.
 * The sweep's own case is SweepFoodLog.B2.targetsForeground.btest.test.ts.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUser: { id: string } | null = { id: 'client-1' };
const mockCurrentForSelf = jest.fn();
jest.mock('../useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../api/macrosApi', () => ({
  macrosApi: { currentForSelf: (...args: unknown[]) => mockCurrentForSelf(...args) },
}));

// Every AppState listener the hook adds; remove() takes it off, as React Native does.
const appStateHandlers: Array<(s: AppStateStatus) => void> = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
  const h = handler as (s: AppStateStatus) => void;
  appStateHandlers.push(h);
  return {
    remove: () => {
      const i = appStateHandlers.indexOf(h);
      if (i >= 0) appStateHandlers.splice(i, 1);
    },
  } as unknown as ReturnType<typeof AppState.addEventListener>;
});

import { useMacroTargets } from '../useMacroTargets';

const target = (calories: number) => ({
  data: {
    id: 'mt', client_id: 'client-1', coach_id: 'coach-1', calories_kcal: calories, protein_g: 150, carbs_g: 200,
    fats_g: 60, fiber_g: null, notes: null, effective_from: '', created_at: '', archived_at: null,
  },
});
const shown = (calories: number) => ({ calories, protein: 150, carbs: 200, fat: 60 });

const appGoes = async (...states: AppStateStatus[]) => {
  await act(async () => {
    for (const s of states) [...appStateHandlers].forEach((h) => h(s));
  });
};
// She leaves the app (another app, the home screen, a locked phone) and comes back to it.
const leaveAndReturn = () => appGoes('inactive', 'background', 'active');

// A screen of the app the hook runs on: the Food tab or Home inside their navigators.
function screenWithFocus() {
  const listeners: Array<() => void> = [];
  const navigation = {
    addListener: jest.fn((event: string, cb: () => void) => {
      if (event === 'focus') listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NavigationContext.Provider value={navigation as never}>{children}</NavigationContext.Provider>
  );
  const focus = async () => {
    await act(async () => {
      [...listeners].forEach((cb) => cb());
    });
  };
  return { wrapper, focus, listeners };
}

describe('TARGETS-REFRESH-M: her targets are read again when she comes back', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCurrentForSelf.mockReset();
    appStateHandlers.length = 0;
    mockUser = { id: 'client-1' };
  });

  it('a failed read on the return (offline) keeps the last good target, with no error state', async () => {
    mockCurrentForSelf.mockResolvedValue(target(2000));
    const { result } = await renderHook(() => useMacroTargets());
    await waitFor(() => expect(result.current).toEqual(shown(2000)));

    mockCurrentForSelf.mockRejectedValue(new Error('Network Error'));
    await leaveAndReturn();

    await waitFor(() => expect(mockCurrentForSelf).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual(shown(2000));
    expect(JSON.parse((await AsyncStorage.getItem('macro_targets:client-1')) as string)).toMatchObject(shown(2000));

    // Back online, the next return reads the new target.
    mockCurrentForSelf.mockResolvedValue(target(1800));
    await leaveAndReturn();
    await waitFor(() => expect(result.current).toEqual(shown(1800)));
  });

  it('one return reads once: a glance away that is not a return reads nothing, and repeated active events add none', async () => {
    mockCurrentForSelf.mockResolvedValue(target(2000));
    const { result } = await renderHook(() => useMacroTargets());
    await waitFor(() => expect(result.current).toEqual(shown(2000)));
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(1);

    // Control Centre or the app switcher: inactive and back, never in the background. Not a return.
    await appGoes('inactive', 'active', 'inactive', 'active');
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(1);

    mockCurrentForSelf.mockResolvedValue(target(1800));
    await appGoes('inactive', 'background', 'active', 'active', 'inactive', 'active');
    await waitFor(() => expect(result.current).toEqual(shown(1800)));
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(2);
  });

  it('the Food tab and Home share one read on a return, and both show the new target', async () => {
    mockCurrentForSelf.mockResolvedValue(target(2000));
    const home = await renderHook(() => useMacroTargets());
    await waitFor(() => expect(home.result.current).toEqual(shown(2000)));
    const food = await renderHook(() => useMacroTargets());
    await waitFor(() => expect(food.result.current).toEqual(shown(2000)));
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(2);

    mockCurrentForSelf.mockResolvedValue(target(1800));
    await leaveAndReturn();

    await waitFor(() => expect(home.result.current).toEqual(shown(1800)));
    await waitFor(() => expect(food.result.current).toEqual(shown(1800)));
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(3);
  });

  it('coming back to the screen (the Food tab or Home gains focus) reads the target again', async () => {
    const screen = screenWithFocus();
    mockCurrentForSelf.mockResolvedValue(target(2000));
    const { result } = await renderHook(() => useMacroTargets(), { wrapper: screen.wrapper });
    await waitFor(() => expect(result.current).toEqual(shown(2000)));
    expect(screen.listeners).toHaveLength(1);

    // Her coach lowers the target while she is in the app (on another tab); she opens the Food tab again.
    mockCurrentForSelf.mockResolvedValue(target(1800));
    await screen.focus();
    await waitFor(() => expect(result.current).toEqual(shown(1800)));
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(2);

    // Offline on the next focus: the target on screen stays.
    mockCurrentForSelf.mockRejectedValue(new Error('Network Error'));
    await screen.focus();
    await waitFor(() => expect(mockCurrentForSelf).toHaveBeenCalledTimes(3));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual(shown(1800));
  });

  it('once the screen is gone (sign-out), a return and a focus read nothing', async () => {
    const screen = screenWithFocus();
    mockCurrentForSelf.mockResolvedValue(target(2000));
    const { result, unmount } = await renderHook(() => useMacroTargets(), { wrapper: screen.wrapper });
    await waitFor(() => expect(result.current).toEqual(shown(2000)));

    await act(async () => {
      unmount();
    });
    expect(appStateHandlers).toHaveLength(0);
    expect(screen.listeners).toHaveLength(0);
    await leaveAndReturn();
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(1);
  });

  it("a return read for one account never paints for the next account, and the next account's read is its own", async () => {
    mockUser = { id: 'client-A' };
    mockCurrentForSelf.mockResolvedValueOnce(target(2000));
    const { result, rerender } = await renderHook(() => useMacroTargets());
    await waitFor(() => expect(result.current).toEqual(shown(2000)));

    // A's return read is still out when A signs out and B signs in on the same phone.
    let releaseA: () => void = () => {};
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    mockCurrentForSelf.mockImplementationOnce(async () => {
      await aGate;
      return target(1900);
    });
    await leaveAndReturn();
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(2);

    mockUser = { id: 'client-B' };
    mockCurrentForSelf.mockResolvedValueOnce(target(1500));
    await rerender(undefined);
    await waitFor(() => expect(result.current).toEqual(shown(1500)));
    expect(mockCurrentForSelf).toHaveBeenCalledTimes(3);

    await act(async () => {
      releaseA();
      await aGate;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual(shown(1500));
    expect(await AsyncStorage.getItem('macro_targets:client-B')).toContain('1500');
    expect(await AsyncStorage.getItem('macro_targets:client-A')).not.toContain('1900');
  });
});
