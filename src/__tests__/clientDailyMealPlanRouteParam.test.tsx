/**
 * ClientDailyMealPlanScreen — route.params.date honor test (PR-13 audit P2-2).
 *
 * The Deliverables timeline routes a delivered `meal_plan` drop into
 * this screen with the drop's `materialised_ref` (an ISO YYYY-MM-DD
 * start date) as the `date` route param. Before PR-13 audit, the
 * screen ignored `route.params` entirely and always rendered today's
 * plan — so tapping a delivered meal plan silently showed the wrong
 * data. This test mounts the screen with a date param and asserts the
 * underlying `useMealPlanToday` hook is called with that date (i.e.
 * the destination actually honors the navigation param).
 *
 * Companion to the source-grep assertion in
 * `deliverablesScreen.test.tsx` — together they prove the wire was
 * actually plugged in, not just claimed in the docstring.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

let mockRouteParams: { date?: string } | undefined = undefined;
const mockUseMealPlanToday = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../hooks/useMealTemplates', () => ({
  useMealPlanToday: (dateIso?: string) => {
    mockUseMealPlanToday(dateIso);
    return {
      data: { assignments: [] },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    };
  },
}));

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: {
      bgPrimary: '#F5EFE4',
      bgSurface: '#F1E8D5',
      accent: '#2C4A36',
      textPrimary: '#1A1A18',
      textMuted: '#B1A89F',
      border: 'rgba(176,141,87,0.2)',
    },
  }),
}));

import ClientDailyMealPlanScreen from '../screens/client/ClientDailyMealPlanScreen';

describe('ClientDailyMealPlanScreen — route.params.date honor (audit P2-2)', () => {
  beforeEach(() => {
    mockUseMealPlanToday.mockReset();
    mockRouteParams = undefined;
  });

  it('passes route.params.date through to useMealPlanToday(date)', async () => {
    mockRouteParams = { date: '2026-05-01' };
    await render(<ClientDailyMealPlanScreen />);
    expect(mockUseMealPlanToday).toHaveBeenCalledWith('2026-05-01');
  });

  it('falls back to undefined (today) when no date param is provided', async () => {
    mockRouteParams = undefined;
    await render(<ClientDailyMealPlanScreen />);
    expect(mockUseMealPlanToday).toHaveBeenCalledWith(undefined);
  });

  it('normalises a full ISO timestamp to YYYY-MM-DD', async () => {
    mockRouteParams = { date: '2026-05-01T08:00:00Z' };
    await render(<ClientDailyMealPlanScreen />);
    expect(mockUseMealPlanToday).toHaveBeenCalledWith('2026-05-01');
  });

  it('drops a malformed date param defensively (not propagated to the hook)', async () => {
    mockRouteParams = { date: 'not-a-date' };
    await render(<ClientDailyMealPlanScreen />);
    expect(mockUseMealPlanToday).toHaveBeenCalledWith(undefined);
  });

  it('renders the meal-plan header when a date is provided', async () => {
    mockRouteParams = { date: '2026-05-01' };
    const { getByText } = await render(<ClientDailyMealPlanScreen />);
    // No assignments → empty state copy mentions "this day" (not "today").
    expect(getByText('Meal plan')).toBeTruthy();
    expect(getByText('No plan for this day')).toBeTruthy();
  });
});
