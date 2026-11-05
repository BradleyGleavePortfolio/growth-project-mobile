/**
 * The client Home in screenshot mode, fed by the screenshot fixtures (HABITS-DEMO-FIX).
 *
 * The rings Home test mocks useHabits with rows that use `name`, so it never saw that
 * DEMO_HABITS used `title`: in screenshot mode the habits tile called `.trim()` on
 * `undefined` and Home threw. Here the real services/api instance answers from the
 * screenshot mock adapter, and the real useApi hooks read it, so Home renders the same
 * fixture rows the store screenshots render. A throw anywhere in Home fails the test.
 *
 * The second block checks every DEMO_ fixture against the type the phone reads it with.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../services/api';
import { installAxiosMockAdapter } from '../mockAdapter';
import * as fixtures from '../fixtures';
import {
  DEMO_COMMUNITY_FEED,
  DEMO_DAILY_TOTAL_ML,
  DEMO_FASTING_HISTORY,
  DEMO_FOOD_LOGS,
  DEMO_HABITS,
  DEMO_MEAL_PLAN_TODAY,
  DEMO_MESSAGES,
  DEMO_RECIPES,
  DEMO_ROMAN_MESSAGES,
  DEMO_ROMAN_SESSION,
  DEMO_USER,
  DEMO_WEIGHT_HISTORY,
} from '../fixtures';
import type { ApiHabit } from '../../hooks/useApi';
import type { CurrentUser } from '../../hooks/useCurrentUser';
import type { ClientTodayResponse } from '../../api/mealTemplatesApi';
import type { HabitRow } from '../../components/home/rings/homeTiles';
import { RomanSessionSchema, RomanWireMessagePageSchema } from '../../api/romanApi';
import { parseWeightLogRow, weightHistoryRows } from '../../screens/client/progress/weightHistory';
import { getTodayString } from '../../utils/date';
import HomeScreen from '../../screens/client/HomeScreen';

let mockRings = true;
const mockDay = {
  // The demo day's totals are what the /log/daily fixture adds up to (Home reads the store).
  foodLogs: [], dailyTotals: { calories: 1030, protein: 73, carbs: 100, fat: 38 }, waterOz: 48, selectedDate: getTodayString(),
  hasLoadedDay: true, loadDayData: jest.fn(), loadProfile: jest.fn(), isLoading: false, loadError: null as string | null,
  logWater: jest.fn(async () => undefined),
};
jest.mock('../../config/featureFlags', () => {
  // Every feature on for v1 (R27): the rings Home is the one with the habits tile. Off is the Home the flag-off build ships.
  const flags = { ...jest.requireActual('../../config/featureFlags').featureFlags, romanChat: true };
  Object.defineProperty(flags, 'clientHomeRings', { get: () => mockRings });
  return { featureFlags: flags };
});
// What seedDemoUser writes to the user cache in screenshot mode.
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => jest.requireActual('../fixtures').DEMO_USER }));
jest.mock('../../hooks/useMacroTargets', () => ({ useMacroTargets: () => ({ calories: 2200, protein: 165, carbs: 230, fat: 70 }) }));
jest.mock('../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockDay, { getState: () => mockDay }) }));
// Screenshot mode has no Health connection: the Sleep and Steps reads come back empty.
jest.mock('../../hooks/useWearableSamples', () => ({
  useWearableSamples: () => ({ data: undefined, isSuccess: false, isError: false, refetch: jest.fn() }),
}));
jest.mock('../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => ({ data: [], isSuccess: true, isError: false, refetch: jest.fn() }),
}));
jest.mock('../../hooks/useDeviceHealthOnOpen', () => ({ useDeviceHealthOnOpen: jest.fn() }));
jest.mock('../../hooks/useHolisticInsights', () => ({ useHolisticInsights: () => ({ data: undefined, isSuccess: false }) }));
jest.mock('../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, confirmedActive: true, status: 'active' }),
}));
jest.mock('../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext(undefined),
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
// Home's other cards are not fed by these fixtures; they keep their own tests.
jest.mock('../../components/coachless/CoachlessHomeSlot', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/home/ProfileNudge', () => () => null);
jest.mock('../../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../../components/home/HolisticInsightsTile', () => () => null);
jest.mock('../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../components/home/CoachIntroductionBanner', () => () => null);
jest.mock('../../components/home/FullMacrosIntroCard', () => () => null);
jest.mock('../../components/tutorial/TutorialHomeSlot', () => () => null);
jest.mock('../../components/PendingInviteBanner', () => () => null);
jest.mock('../../components/join/FinishJoining', () => () => null);

/** Holds what Home threw, so the failure names the error instead of a missing text. */
class Catch extends React.Component<{ children: React.ReactNode; onError: (e: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { this.props.onError(e); }
  render() { return this.state.failed ? null : this.props.children; }
}

const prevMode = process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
const realAdapter = api.defaults.adapter;
beforeAll(() => {
  process.env.EXPO_PUBLIC_SCREENSHOT_MODE = '1';
  installAxiosMockAdapter();
  expect(api.defaults.adapter).not.toBe(realAdapter);
});
afterAll(() => {
  api.defaults.adapter = realAdapter;
  if (prevMode === undefined) delete process.env.EXPO_PUBLIC_SCREENSHOT_MODE;
  else process.env.EXPO_PUBLIC_SCREENSHOT_MODE = prevMode;
});

let client: QueryClient | undefined;
afterEach(() => client?.clear());

async function renderHome() {
  const thrown: Error[] = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={client}>
      <Catch onError={(e) => thrown.push(e)}><HomeScreen /></Catch>
    </QueryClientProvider>,
  );
  return { thrown };
}

describe('client Home in screenshot mode', () => {
  it('the rings Home renders the DEMO_HABITS rows through the real /habits read and does not throw', async () => {
    mockRings = true;
    const { thrown } = await renderHome();
    // The habits tile names the demo habits once /habits and /habits/logs answer from the fixtures.
    expect(await screen.findByText(/Hydrate/, {}, { timeout: 4000 })).toBeTruthy();
    await waitFor(() => expect(client?.isFetching()).toBe(0), { timeout: 4000 });
    expect(thrown).toEqual([]);
    expect(client?.getQueryData(['habits', 'list'])).toEqual(DEMO_HABITS);
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('the flag-off Home renders with the fixtures and does not throw', async () => {
    mockRings = false;
    const { thrown } = await renderHome();
    expect(await screen.findByTestId('home-scroll', {}, { timeout: 4000 })).toBeTruthy();
    // Every fixture read Home makes has answered before the throw check.
    await waitFor(() => expect(client?.isFetching()).toBe(0), { timeout: 4000 });
    expect(thrown).toEqual([]);
  });
});

/**
 * Each DEMO_ fixture against the type its screen reads it with. `satisfies` holds the
 * compile-time shape (tsc fails on drift); the runtime rows hold the fields the reader
 * needs, for the readers whose row type is not exported.
 */
describe('DEMO_ fixtures match the phone API types', () => {
  it('every DEMO_ export is listed here, so a new fixture gets a check', () => {
    const demo = Object.keys(fixtures).filter((k) => k.startsWith('DEMO_')).sort();
    expect(demo).toEqual([
      'DEMO_AUTH_ME', 'DEMO_COMMUNITY_FEED', 'DEMO_DAILY_TOTAL_ML', 'DEMO_FASTING_HISTORY', 'DEMO_FOOD_LOGS',
      'DEMO_HABITS', 'DEMO_MEAL_PLAN_TODAY', 'DEMO_MESSAGES', 'DEMO_RECIPES', 'DEMO_ROMAN_MESSAGES',
      'DEMO_ROMAN_SESSION', 'DEMO_USER', 'DEMO_WEIGHT_HISTORY', 'DEMO_WORKOUT_PARAMS',
    ]);
  });

  it('DEMO_HABITS is the GET /habits row (ApiHabit, the tile HabitRow): `name`, never `title`', () => {
    // The server spreads the Prisma Habit row (HabitsService.getHabits); its column is `name`.
    const rows: readonly (Omit<ApiHabit, 'created_at'> & HabitRow)[] = DEMO_HABITS;
    for (const h of rows) {
      expect(typeof h.name).toBe('string');
      expect(h.name.trim()).not.toBe('');
      expect(h.user_id).toBe(DEMO_USER.id);
      expect(h).not.toHaveProperty('title');
    }
  });

  it('DEMO_USER, DEMO_AUTH_ME and DEMO_MEAL_PLAN_TODAY carry their exported types', () => {
    expect((DEMO_USER satisfies CurrentUser).id).toBe('demo-user-screenshot');
    expect(fixtures.DEMO_AUTH_ME.user.id).toBe(DEMO_USER.id);
    expect(fixtures.DEMO_AUTH_ME.profile).toBe(DEMO_USER.profile);
    expect((DEMO_MEAL_PLAN_TODAY satisfies ClientTodayResponse).plan).not.toBeNull();
  });

  it('the Roman fixtures parse with the strict wire schemas the Roman API uses', () => {
    expect(RomanSessionSchema.safeParse(DEMO_ROMAN_SESSION).success).toBe(true);
    const page = RomanWireMessagePageSchema.safeParse({ messages: DEMO_ROMAN_MESSAGES, nextCursor: null });
    expect(page.success ? [] : page.error.issues).toEqual([]);
  });

  it('every DEMO_WEIGHT_HISTORY row parses as a WeightLog', () => {
    const rows = weightHistoryRows({ logs: DEMO_WEIGHT_HISTORY });
    expect(rows).toHaveLength(DEMO_WEIGHT_HISTORY.length);
    for (const r of rows) expect(parseWeightLogRow(r, DEMO_USER.id)).not.toBeNull();
  });

  it('the rows whose reader type is not exported carry the fields the reader uses', () => {
    // clientStore DailyLogEntry with a RawFoodItem food_item.
    for (const e of DEMO_FOOD_LOGS) {
      expect(e).toEqual(expect.objectContaining({ id: expect.any(String), food_item_id: expect.any(String), meal_type: expect.any(String),
        quantity_multiplier: expect.any(Number), food_item: expect.objectContaining({ name: expect.any(String), calories: expect.any(Number) }) }));
    }
    expect(typeof DEMO_DAILY_TOTAL_ML).toBe('number');
    // FastingScreen SessionRow.
    for (const s of DEMO_FASTING_HISTORY) {
      expect(s).toEqual(expect.objectContaining({ id: expect.any(String), start_time: expect.any(String) }));
    }
    // RecipesScreen Recipe.
    for (const r of DEMO_RECIPES) {
      expect(r).toEqual(expect.objectContaining({ id: expect.any(String), title: expect.any(String), prep_time_min: expect.any(Number),
        cook_time_min: expect.any(Number), servings: expect.any(Number), calories: expect.any(Number), protein: expect.any(Number),
        ingredients: expect.any(Array), instructions: expect.any(Array), tags: expect.any(Array), _count: { saved_by: expect.any(Number) } }));
    }
    // MessagesScreen Message.
    for (const m of DEMO_MESSAGES) {
      expect(m).toEqual(expect.objectContaining({ id: expect.any(String), sender_id: expect.any(String), body: expect.any(String),
        created_at: expect.any(String) }));
      expect(['coach', 'client']).toContain(m.sender_role);
    }
    // /community/feed: no phone screen reads it yet (communityApi.getFeed has no caller); a list of posts with an id and a body.
    for (const p of DEMO_COMMUNITY_FEED) expect(p).toEqual(expect.objectContaining({ id: expect.any(String), body: expect.any(String) }));
  });
});
