// FIX-954R2 (m#954): the class test for the three promises of fix round 2.
// A: no list refresh or data update moves the page: `refreshing` is true only while the user's own pull is in flight.
// C1: the list keeps one tree in every state, so the add form is not rebuilt. C: no list input is ever under 44 pt.
// The native half of A (RCTPullToRefreshViewComponentView moving the offset) cannot run here: see the PR's Could not check.
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi, prepGuideApi, recipesApi } from '../../../services/api';
import { getLocalWeekStart } from '../../../utils/date';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';
import RecipesScreen from '../RecipesScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: [] } }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), bulkAdd: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
  recipesApi: { list: jest.fn(), listSaved: jest.fn(), allergens: jest.fn() },
  profileApi: { update: jest.fn() },
}));

const rows = [
  { id: 'one', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false, added_at: '2026-11-01' },
  { id: 'two', name: 'Eggs', quantity: 1, is_checked: false, added_at: '2026-11-01' },
];
const guide = {
  recipes: [{ id: 'soup', title: 'Soup', prep_time_min: 10, cook_time_min: 20, servings: 2, calories: 320 }],
  aggregated_ingredients: [{ name: 'Carrots', quantity: 2, unit: 'kg' }],
  prep_day_suggestions: [],
};
const recipe = { id: 'r1', title: 'Lentil soup', calories: 320, protein: 24, carbs: 40, fat: 8, prep_time_min: 5, cook_time_min: 20, servings: 2, tags: ['vegan'] };

type Read = jest.Mock;
interface Lane {
  name: string; Screen: React.ComponentType; scroll: string; key: unknown[]; data: unknown; shown: string; read: () => Read;
  /** Recipes shows its error block only when no row is on screen, so its failed reload starts from an empty library. */
  beforeError: { data: unknown; shown: string };
}
const grocery: Lane = {
  name: 'Grocery', Screen: GroceryListScreen, scroll: 'list-scroll', key: ['lists', 'grocery'], data: rows, shown: 'Milk',
  read: () => jest.mocked(listsApi.getList) as unknown as Read, beforeError: { data: rows, shown: 'Milk' },
};
const shopping: Lane = {
  name: 'Shopping', Screen: ShoppingListScreen, scroll: 'list-scroll', key: ['lists', 'shopping'], data: rows, shown: 'Milk',
  read: () => jest.mocked(listsApi.getList) as unknown as Read, beforeError: { data: rows, shown: 'Milk' },
};
const prep: Lane = {
  name: 'Prep guide', Screen: PrepGuideScreen, scroll: 'list-scroll', key: ['prep-guide', getLocalWeekStart(0)], data: guide, shown: 'Soup',
  read: () => jest.mocked(prepGuideApi.getWeeklyGuide) as unknown as Read, beforeError: { data: guide, shown: 'Soup' },
};
const recipes: Lane = {
  name: 'Recipes', Screen: RecipesScreen, scroll: 'recipes-list', key: ['recipes'], data: [recipe], shown: 'Lentil soup',
  read: () => jest.mocked(recipesApi.list) as unknown as Read, beforeError: { data: [], shown: 'No recipes yet' },
};
const allLists = [grocery, shopping, prep, recipes].map((lane) => [lane.name, lane] as const);
const bothInputLists = [grocery, shopping].map((lane) => [lane.name, lane] as const);

// Every read answers from `mode`: at once, by failing, or held open until release().
let mode: 'ok' | 'fail' | 'hold' = 'ok';
let payload: unknown;
let held: Array<() => void> = [];
const answer = () => {
  if (mode === 'ok') return Promise.resolve({ data: payload });
  if (mode === 'fail') return Promise.reject(new Error('offline'));
  return new Promise((resolve) => { held.push(() => resolve({ data: payload })); });
};
const release = async () => {
  mode = 'ok';
  await act(async () => { held.splice(0).forEach((open) => open()); });
};
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

const clients: QueryClient[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  mode = 'ok';
  held = [];
  for (const read of [listsApi.getList, prepGuideApi.getWeeklyGuide, recipesApi.list, recipesApi.listSaved]) (jest.mocked(read) as unknown as Read).mockImplementation(answer);
  (jest.mocked(recipesApi.allergens) as unknown as Read).mockResolvedValue({ data: null });
  for (const write of [listsApi.addItem, listsApi.updateItem, listsApi.deleteItem]) (jest.mocked(write) as unknown as Read).mockResolvedValue({ data: {} });
});
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); });

async function mount(lane: Lane, seed?: { data: unknown }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  if (seed) client.setQueryData(lane.key, seed.data, { updatedAt: 0 });
  const ui = await render(<QueryClientProvider client={client}><lane.Screen /></QueryClientProvider>);
  type Control = React.ReactElement<{ refreshing: boolean; enabled?: boolean; onRefresh: () => Promise<void> }>;
  const control = () => ui.getByTestId(lane.scroll).props.refreshControl as Control;
  const refreshing = () => control().props.refreshing;
  return { ui, client, control, refreshing };
}
async function loaded(lane: Lane, data: unknown = lane.data, shown: string = lane.shown) {
  payload = data;
  const page = await mount(lane);
  await page.ui.findByText(shown);
  expect(page.refreshing()).toBe(false);
  return page;
}
/** Starts the user's pull with the read held open, without waiting for it to finish. */
async function pull(page: Awaited<ReturnType<typeof mount>>) {
  mode = 'hold';
  await act(async () => { void page.control().props.onRefresh(); });
}

describe('A: refreshing is true only during a pull the user made', () => {
  describe.each(bothInputLists)('%s', (_name, lane) => {
    it.each(['a tick', 'a remove', 'an add'])('case 1: %s holds still while the list reloads', async (action) => {
      const page = await loaded(lane);
      const before = lane.read().mock.calls.length;
      mode = 'hold';
      if (action === 'a tick') await fireEvent.press(page.ui.getByRole('checkbox', { name: 'Check Milk' }));
      if (action === 'a remove') await fireEvent.press(page.ui.getByRole('button', { name: 'Remove Milk' }));
      if (action === 'an add') {
        await fireEvent.changeText(page.ui.getByPlaceholderText('Add item…'), 'Bread');
        await fireEvent.press(page.ui.getByRole('button', { name: 'Add item' }));
      }
      await waitFor(() => expect(lane.read().mock.calls.length).toBeGreaterThan(before));
      await settle();
      expect(page.refreshing()).toBe(false);
    });

    it('case 6: a tick during a pull cancels the read and the spinner still ends', async () => {
      const page = await loaded(lane);
      await pull(page);
      await waitFor(() => expect(page.refreshing()).toBe(true));
      const reads = lane.read().mock.calls.length;
      await fireEvent.press(page.ui.getByRole('checkbox', { name: 'Check Milk' }));
      // The tick's own reload is held open too, so this also proves that reload does not bring the spinner back.
      await waitFor(() => expect(lane.read().mock.calls.length).toBeGreaterThan(reads));
      await settle();
      expect(page.refreshing()).toBe(false);
    });
  });

  describe.each(allLists)('%s', (_name, lane) => {
    it('case 2: opening with stale cached data holds still while it reloads', async () => {
      mode = 'hold';
      payload = lane.data;
      const page = await mount(lane, { data: lane.data });
      await waitFor(() => expect(lane.read()).toHaveBeenCalled());
      await settle();
      await page.ui.findByText(lane.shown);
      expect(page.refreshing()).toBe(false);
    });

    it('case 3: Try again holds still while it reloads', async () => {
      const page = await loaded(lane, lane.beforeError.data, lane.beforeError.shown);
      mode = 'fail';
      await act(async () => { await page.control().props.onRefresh(); });
      const tryAgain = await page.ui.findByRole('button', { name: 'Try again' });
      const before = lane.read().mock.calls.length;
      mode = 'hold';
      await fireEvent.press(tryAgain);
      await waitFor(() => expect(lane.read().mock.calls.length).toBeGreaterThan(before));
      await settle();
      expect(page.refreshing()).toBe(false);
    });

    it('case 4: a pull shows the spinner until the read settles', async () => {
      const page = await loaded(lane);
      await pull(page);
      await waitFor(() => expect(page.refreshing()).toBe(true));
      await settle();
      expect(page.refreshing()).toBe(true);
      await release();
      await waitFor(() => expect(page.refreshing()).toBe(false));
    });

    it('case 5: a failed pull ends the spinner and shows the error block', async () => {
      const page = await loaded(lane, lane.beforeError.data, lane.beforeError.shown);
      mode = 'fail';
      await act(async () => { await page.control().props.onRefresh(); });
      await page.ui.findByRole('button', { name: 'Try again' });
      expect(page.refreshing()).toBe(false);
    });
  });
});

describe.each(bothInputLists)('C1: %s keeps its refresh control in every state', (_name, lane) => {
  const empty = `Your ${lane === grocery ? 'grocery' : 'shopping'} list is empty`;
  it('loading', async () => {
    mode = 'hold';
    payload = [];
    const page = await mount(lane);
    await settle();
    expect(page.control()).toBeTruthy();
    expect(page.control().props.enabled).toBe(false);
  });
  it('empty', async () => {
    const page = await loaded(lane, [], empty);
    expect(page.control().props.enabled).toBe(false);
  });
  it('error', async () => {
    mode = 'fail';
    const page = await mount(lane);
    await page.ui.findByRole('button', { name: 'Try again' });
    expect(page.control().props.enabled).toBe(false);
  });
  it('with rows', async () => {
    const page = await loaded(lane);
    expect(page.control().props.enabled).toBe(true);
  });
});

// iOS multipliers (RCTAccessibilityManager.mm:260-262) and Android's 0.85. Only 0.823 proves the Qty width floor.
const sizes: Array<[number, { height: number; qty: number; unit: number }]> = [
  [0.823, { height: 44, qty: 44, unit: 57.61 }],
  [0.85, { height: 44, qty: 44.2, unit: 59.5 }],
  [0.882, { height: 44, qty: 45.864, unit: 61.74 }],
  [0.941, { height: 45.168, qty: 48.932, unit: 65.87 }],
  [1, { height: 48, qty: 52, unit: 70 }],
  [1.3, { height: 62.4, qty: 67.6, unit: 91 }],
];
describe.each(bothInputLists)('C: %s input fields', (_name, lane) => {
  it.each(sizes)('at system text %s', async (fontScale, want) => {
    const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 320, height: 568, scale: 1, fontScale });
    try {
      payload = [];
      const page = await mount(lane);
      const field = (placeholder: string) => StyleSheet.flatten(page.ui.getByPlaceholderText(placeholder).props.style);
      const name = field('Add item…'), qty = field('Qty'), unit = field('Unit');
      for (const style of [name, qty, unit]) expect(style.height).toBeCloseTo(want.height, 3);
      expect(qty.width).toBeCloseTo(want.qty, 3);
      expect(unit.width).toBeCloseTo(want.unit, 3);
      // The text keeps its 10 pt baseline in a floored field: padding follows the height, not the scale alone.
      expect(name.paddingTop).toBeCloseTo(want.height - 18 * 1.21 * fontScale - 10, 3);
      for (const style of [qty, unit]) expect(style.paddingTop).toBeCloseTo(want.height - 16 * 1.21 * fontScale - 10, 3);
      await page.ui.unmount();
    } finally {
      dimensions.mockRestore();
    }
  });
});
