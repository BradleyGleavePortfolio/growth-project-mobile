// LO-PLAN-SWAPS-M-2 B1 (LO lens, growth-project-mobile#1009 @ 768c578d): the round-1 fix starts a new visit each time
// the plan meal page comes back into focus (PlanMealScreen.tsx:100-115). The new visit hides the footer until a day
// log read for that visit lands, so LogPlannedMealButton unmounts and its own state goes with it. Offline that read
// fails (the app wires no React Query onlineManager: useCoachCommunity.ts:74-75), and the log in hand cannot hold a
// food saved offline. So a client who saved Dinner offline on the page ("Saved offline. It syncs ...") and looked at
// the Food tab is offered "Ate it as planned" again when she comes back. A second tap queues Dinner a second time.
// At b14e1008 the page kept the button, and its queued line, while it stayed mounted. Fictional data (client Jordan,
// coach Sam).
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import PlanMealScreen from '../PlanMealScreen';

jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true, romanChat: true, offlineFoodInDay: true } };
});
// useFocusEffect as React Navigation runs it: once when the screen is focused, and again each time it is focused again.
const mockFocus: { cb: (() => void) | null } = { cb: null };
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    useRoute: () => ({ params: { date: '2026-11-24', slotId: 's-din' } }),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      R.useEffect(() => {
        mockFocus.cb = cb;
        cb();
      }, [cb]);
    },
  };
});
const mockGet = jest.fn();
const mockDaily = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  recipesApi: { getById: jest.fn(async () => ({ data: { id: 'r1', ingredients: ['Salmon fillet 160 g'], instructions: [], allergens: [], allergens_declared: true } })) },
  listsApi: { bulkAdd: jest.fn() },
  logApi: { getDaily: (...a: unknown[]) => mockDaily(...a), deleteEntry: jest.fn(), logFood: jest.fn() },
  foodApi: { create: jest.fn() },
}));
// The phone's own offline queue (foodLogQueue on the jest AsyncStorage), as LogPlannedMealButton writes it.
const queued = async () => (await jest.requireActual('../../../../services/foodLogQueue').readQueue()) as unknown[];
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
}));
jest.useFakeTimers({
  now: new Date('2026-11-24T19:40:00'),
  advanceTimers: true,
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});
afterAll(() => jest.useRealTimers());

const TODAY = '2026-11-24';
const dinner = {
  id: 'm-din', coach_id: 'sam', name: 'Salmon, potatoes and green beans', description: null,
  calories_kcal: 620, protein_g: 42, carbs_g: 55, fats_g: 22, fiber_g: null, items: null, created_at: '', archived_at: null,
};
const plan = {
  date: TODAY,
  changes_today: [],
  assignments: [{
    id: 'a1',
    daily_meal_plan: {
      id: 'p1', coach_id: 'sam', name: 'Training day', notes: null,
      slots: [{ id: 's-din', daily_meal_plan_id: 'p1', meal_template_id: 'm-din', slot_label: 'dinner', order: 0,
        time_of_day: '19:30', meal_template: dinner, swaps: [], recipe_id: 'r1' }],
    },
  }],
};
// What a request sends back with no connection (axios: no response).
const noConnection = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

let client: QueryClient | null = null;
beforeEach(async () => {
  jest.clearAllMocks();
  await jest.requireActual('../../../../services/foodLogQueue').clearQueue();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) return { data: plan };
    if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
    throw new Error(`unexpected GET ${url}`);
  });
  // Online when the page opens: Dinner is not eaten yet.
  mockDaily.mockResolvedValue({ data: { entries: [] } });
});
afterEach(() => {
  client?.clear();
  client = null;
});

describe('LO-PLAN-SWAPS-M-2 B1: a plan meal saved offline on its page stays saved when she comes back to the page', () => {
  it('Dinner saved offline, then the Food tab and back: never "Ate it as planned" again', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 10 * 60_000 } } });
    await render(
      <QueryClientProvider client={client}>
        <PlanMealScreen />
      </QueryClientProvider>,
    );
    const button = await screen.findByText('Ate it as planned');

    // The connection drops in the kitchen; she taps "Ate it as planned" and the button queues Dinner.
    (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false, isInternetReachable: false });
    mockDaily.mockRejectedValue(noConnection());
    fireEvent.press(button);
    expect(await screen.findByText(/^Saved offline\./)).toBeTruthy();
    expect(await queued()).toHaveLength(1);

    // She looks at the Food tab (the page blurs, stays mounted in the You stack) and taps the You tab again.
    await act(async () => {
      mockFocus.cb?.();
    });
    // Any read the page makes now fails with no connection; let it settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(screen.queryByText('Ate it as planned')).toBeNull();
    expect(await queued()).toHaveLength(1);
  });
});
