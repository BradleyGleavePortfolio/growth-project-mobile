/**
 * B-DELIV-125 — delivered package content opens what was bought.
 *
 * B3: a buyer tapped a delivered PDF or video and nothing happened (the row
 *     was disabled and claimed "Saved to your library"). The row now asks
 *     GET /v1/client/media/:asset_id/signed-url for a grant-scoped link and
 *     opens it; every failure is a specific message.
 * B4: the backend stores a delivered meal plan's DailyMealPlanAssignment id
 *     in `materialised_ref`; mobile routed it as a date, the screen dropped
 *     it and showed the newest plan. It now routes { assignmentId } and the
 *     screen shows exactly that assignment.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockOpenBrowser = jest.fn();
const mockGetPurchaseDrops = jest.fn();
const mockUseMealPlanToday = jest.fn();
let mockRouteParams: Record<string, string> | undefined = { purchaseId: 'purchase_1' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: () => undefined }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (_cb: () => void) => {
    // intentionally empty: first-mount load covers the data path
  },
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowser(...args),
}));

jest.mock('../hooks/useMealTemplates', () => ({
  useMealPlanToday: (dateIso?: string) => mockUseMealPlanToday(dateIso),
}));

jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});

jest.mock('../api/clientPaymentsApi', () => {
  const actual = jest.requireActual('../api/clientPaymentsApi');
  return {
    ...actual,
    clientPaymentsApi: {
      ...actual.clientPaymentsApi,
      getPurchaseDrops: (...args: unknown[]) => mockGetPurchaseDrops(...args),
    },
  };
});

import api from '../services/api';
import DeliverablesScreen from '../screens/client/DeliverablesScreen';
import ClientDailyMealPlanScreen from '../screens/client/ClientDailyMealPlanScreen';
import { isTappableDelivered } from '../screens/client/deliverables/dropRow';
import type { ScheduledDropView } from '../api/clientPaymentsApi';

const ASSIGNMENT_ID = '7b0f7f9e-3c5e-4f0a-9b8e-2f4b9d1c6a11';

function drop(overrides: Partial<ScheduledDropView>): ScheduledDropView {
  return {
    id: 'drop_1',
    asset_type: 'pdf',
    asset_id: 'media_asset_1',
    asset_revision_id: null,
    cadence_kind: 'immediate',
    display_title: 'Starter guide',
    display_caption: null,
    fire_at: null,
    fired_at: '2026-10-01T10:00:00Z',
    status: 'fired',
    materialised_ref: 'grant_1',
    ...overrides,
  };
}

async function tapDrop(d: ScheduledDropView) {
  mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: [d] });
  const screen = await render(<DeliverablesScreen />);
  await waitFor(() => expect(screen.getByTestId(`drop-row-${d.id}`)).toBeTruthy());
  await fireEvent.press(screen.getByTestId(`drop-row-${d.id}`));
  return screen;
}

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });
}

describe('B3 — a delivered PDF or video opens', () => {
  let getSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockOpenBrowser.mockReset();
    mockOpenBrowser.mockResolvedValue({ type: 'opened' });
    mockGetPurchaseDrops.mockReset();
    mockRouteParams = { purchaseId: 'purchase_1' };
    getSpy = jest.spyOn(api, 'get');
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    getSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('delivered pdf and video rows are tappable when they carry the media asset id', () => {
    expect(isTappableDelivered(drop({ asset_type: 'pdf' }))).toBe(true);
    expect(isTappableDelivered(drop({ asset_type: 'video' }))).toBe(true);
    expect(isTappableDelivered(drop({ asset_type: 'pdf', asset_id: '' }))).toBe(false);
    expect(isTappableDelivered(drop({ asset_type: 'video', status: 'pending' }))).toBe(false);
  });

  it('tapping a PDF signs the asset id (not the grant id) and opens the link', async () => {
    getSpy.mockResolvedValue({ data: { url: 'https://files.example/guide.pdf?token=t', kind: 'pdf' } });
    await tapDrop(drop({ asset_type: 'pdf' }));
    await waitFor(() =>
      expect(mockOpenBrowser).toHaveBeenCalledWith('https://files.example/guide.pdf?token=t'),
    );
    expect(getSpy).toHaveBeenCalledWith('/v1/client/media/media_asset_1/signed-url');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('a video still processing says so instead of opening', async () => {
    getSpy.mockRejectedValue(httpError(409));
    await tapDrop(drop({ id: 'drop_v', asset_type: 'video', asset_id: 'media_video_1' }));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Still processing',
        'This file is still being prepared. Try again in a few minutes.',
      ),
    );
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('no access (404, including a backend without the route) is a specific message', async () => {
    getSpy.mockRejectedValue(httpError(404));
    await tapDrop(drop({}));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('File not available', expect.any(String)));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('no network is a specific message, never the raw transport error', async () => {
    getSpy.mockRejectedValue(new Error('Network Error'));
    await tapDrop(drop({}));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not open file', 'Check your connection and try again.'),
    );
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('a delivered row no longer claims "Saved to your library"', async () => {
    const screen = await tapDrop(drop({ fired_at: null }));
    expect(screen.queryByText('Saved to your library')).toBeNull();
  });
});

describe('B4 — a delivered meal plan opens that plan', () => {
  const plan = (id: string, name: string, startsOn: string) => ({
    id,
    daily_meal_plan_id: `plan_${id}`,
    client_id: 'client_1',
    assigned_by_coach_id: 'coach_1',
    starts_on: startsOn,
    ends_on: null,
    created_at: startsOn,
    daily_meal_plan: { id: `plan_${id}`, name, slots: [] },
  });

  beforeEach(() => {
    mockNavigate.mockReset();
    mockGetPurchaseDrops.mockReset();
    mockUseMealPlanToday.mockReset();
    mockRouteParams = { purchaseId: 'purchase_1' };
  });

  it('routes the assignment id as an assignment, not as a date', async () => {
    await tapDrop(drop({ id: 'drop_mp', asset_type: 'meal_plan', materialised_ref: ASSIGNMENT_ID }));
    expect(mockNavigate).toHaveBeenCalledWith('ClientDailyMealPlan', { assignmentId: ASSIGNMENT_ID });
  });

  it('a legacy date ref still routes by date', async () => {
    await tapDrop(drop({ id: 'drop_mp', asset_type: 'meal_plan', materialised_ref: '2026-10-01' }));
    expect(mockNavigate).toHaveBeenCalledWith('ClientDailyMealPlan', { date: '2026-10-01' });
  });

  function mealPlanData(assignments: ReturnType<typeof plan>[]) {
    mockUseMealPlanToday.mockReturnValue({
      data: { date: '2026-10-06', assignments },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    });
  }

  it('the meal plan screen shows the delivered assignment, not the newest plan', async () => {
    mealPlanData([
      plan('newer', 'Coach cut plan', '2026-10-05'),
      plan(ASSIGNMENT_ID, 'Package bulk plan', '2026-10-01'),
    ]);
    mockRouteParams = { assignmentId: ASSIGNMENT_ID };
    const screen = await render(<ClientDailyMealPlanScreen />);
    expect(mockUseMealPlanToday).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('Package bulk plan')).toBeTruthy();
    expect(screen.queryByText('Coach cut plan')).toBeNull();
    expect(screen.getByText('Meal plan')).toBeTruthy();
  });

  it('an assignment that is no longer active says it ended instead of showing another plan', async () => {
    mealPlanData([plan('newer', 'Coach cut plan', '2026-10-05')]);
    mockRouteParams = { assignmentId: ASSIGNMENT_ID };
    const screen = await render(<ClientDailyMealPlanScreen />);
    expect(screen.getByTestId('meal-plan-ended')).toBeTruthy();
    expect(screen.queryByText('Coach cut plan')).toBeNull();
  });
});
