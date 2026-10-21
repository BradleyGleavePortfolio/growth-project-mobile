/**
 * CREDITBUILD-143: the coach home shows "Your AI credits are low." at 80 %
 * and "Your AI credits are used up." at 100 %, each once per pool period per
 * coach, only while the home is focused and only with a pool (head coaches);
 * Buy opens the existing pack checkout with that pack chosen; Other amounts
 * opens it with the amount field open (#161-15 op 1).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoachAIBudgetResponse } from '../../../../api/types/coachAIBudget';
import type { CoachCredits } from '../useCoachCredits';

let mockCredits: CoachCredits | null = null;
let mockFocused = true;
const mockNavigate = jest.fn();
jest.mock('../useCoachCredits', () => ({ useCoachCredits: () => mockCredits }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach_1' }) }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import CreditMomentsHost, { momentFor, momentSeenKey } from '../CreditMomentsHost';
import { preselectedPack } from '../creditPace';

const pool = (pct: number): CoachCredits => ({
  packsSold: true,
  budget: {
    period_start: '2026-10-01T00:00:00.000Z',
    period_end: '2026-11-01T00:00:00.000Z',
    used_displayed_cents: pct * 125,
    total_displayed_cents: 12500,
    remaining_displayed_cents: 12500 - pct * 125,
    base_displayed_cents: 12500,
    pct_used: pct,
    pack_options_cents: [1000, 2500, 9900],
  } as CoachAIBudgetResponse,
});
const LOW_KEY = momentSeenKey('coach_1', '2026-10-01T00:00:00.000Z', 'low');
let getItem: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  getItem = jest.spyOn(AsyncStorage, 'getItem');
  mockCredits = pool(80);
  mockFocused = true;
});
afterEach(() => getItem.mockRestore());

describe('AI credit moments on the coach home', () => {
  it('picks the moment from the share used', () => {
    expect([momentFor(79), momentFor(80), momentFor(99), momentFor(100), momentFor(130)]).toEqual([
      null,
      'low',
      'low',
      'usedUp',
      'usedUp',
    ]);
  });

  it('shows the low sheet once per period for this coach', async () => {
    const first = await render(<CreditMomentsHost />);
    await screen.findByText('Your AI credits are low.');
    await waitFor(async () => expect(await AsyncStorage.getItem(LOW_KEY)).toBe('1'));
    await fireEvent.press(screen.getByText('Not now'));
    expect(screen.queryByText('Your AI credits are low.')).toBeNull();
    await first.unmount();

    const calls = getItem.mock.calls.length;
    await render(<CreditMomentsHost />);
    await waitFor(() => expect(getItem).toHaveBeenCalledTimes(calls + 1));
    await act(async () => {
      await getItem.mock.results[calls].value;
    });
    expect(screen.queryByText('Your AI credits are low.')).toBeNull();
  });

  it('shows the used-up sheet at 100 %', async () => {
    mockCredits = pool(100);
    await render(<CreditMomentsHost />);
    await screen.findByText('Your AI credits are used up.');
    expect(await AsyncStorage.getItem(momentSeenKey('coach_1', '2026-10-01T00:00:00.000Z', 'usedUp'))).toBe('1');
    expect(await AsyncStorage.getItem(LOW_KEY)).toBeNull();
  });

  it('shows nothing under 80 %, without a pool, or away from the home', async () => {
    mockCredits = pool(79);
    const view = await render(<CreditMomentsHost />);
    mockCredits = null;
    await view.rerender(<CreditMomentsHost />);
    mockCredits = pool(80);
    mockFocused = false;
    await view.rerender(<CreditMomentsHost />);
    expect(screen.queryByText('Your AI credits are low.')).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LOW_KEY)).toBeNull();
  });

  it('Buy opens the pack checkout with the chosen pack', async () => {
    await render(<CreditMomentsHost />);
    await fireEvent.press(await screen.findByTestId('credit-moment-buy'));
    expect(mockNavigate).toHaveBeenLastCalledWith('SettingsStack', {
      screen: 'CreditPackCheckout',
      params: { preselect: preselectedPack(pool(80).budget) },
      initial: false,
    });
  });

  // #161-15 op 1: Other amounts on both sheets opens the pack screen with the amount field open.
  it.each([
    [80, 'Your AI credits are low.'],
    [100, 'Your AI credits are used up.'],
  ])('Other amounts on the %s %% sheet opens the pack checkout with the amount field open', async (pct, title) => {
    mockCredits = pool(pct);
    await render(<CreditMomentsHost />);
    await screen.findByText(title);
    await fireEvent.press(screen.getByTestId('credit-moment-other'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenLastCalledWith('SettingsStack', {
      screen: 'CreditPackCheckout',
      params: { preselect: 'custom' },
      initial: false,
    });
    expect(screen.queryByText(title)).toBeNull();
  });
});
