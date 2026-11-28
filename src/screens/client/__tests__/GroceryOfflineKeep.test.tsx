/**
 * GROCERY-OFFLINE-KEEP-M (SWEEP-KITCHEN B1, agent alm): a re-read of the Grocery list or the Prep guide that fails keeps
 * what she already has on screen; the failed notice and Try again are only for a page with no answer yet.
 * The class of m#1008 LS-KWM-2 C1 (7229714411, "a re-read that fails keeps the last good answer"), ruled fix now.
 * The sweep's own two cases are in SWEEP_KITCHEN.B1.groceryKeepsList.btest.test.tsx; this file adds the ways in it named:
 * a tick or a remove that fails offline (their onSettled re-read fails too), a cold start on a saved query that ended in
 * an error (queryClient.ts saves a query in any state), and the notice that must stay for a list with no answer.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, dehydrate, hydrate, type QueryKey } from '@tanstack/react-query';
import { listsApi, prepGuideApi } from '../../../services/api';
import { serializePersistedClient } from '../../../services/queryClient';
import GroceryListScreen from '../GroceryListScreen';
import PrepGuideScreen from '../PrepGuideScreen';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), bulkAdd: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
}));

type ListResponse = Awaited<ReturnType<typeof listsApi.getList>>;
type GuideResponse = Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>;
const KEY = ['lists', 'grocery'];
const rows = [
  { id: 'milk', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false, added_at: '2026-11-27T10:00:00Z' },
  { id: 'eggs', name: 'Eggs', quantity: 12, is_checked: false, added_at: '2026-11-27T10:01:00Z' },
];
const guide = {
  source: 'plan', week_filter_applied: false,
  recipes: [{ id: 'soup', title: 'Soup', prep_time_min: 10, cook_time_min: 20, servings: 2, calories: 320 }],
  aggregated_ingredients: [{ name: 'Carrots', quantity: 2, unit: 'kg' }],
  prep_day_suggestions: ['Sunday'],
};
// What axios throws with no connection: no response, code ERR_NETWORK.
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const online = () => {
  jest.mocked(listsApi.getList).mockImplementation((type) => Promise.resolve({ data: type === 'grocery' ? rows : [] } as unknown as ListResponse));
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: guide } as unknown as GuideResponse);
};
const goOffline = () => {
  for (const call of [listsApi.getList, listsApi.updateItem, listsApi.deleteItem, prepGuideApi.getWeeklyGuide]) {
    jest.mocked(call).mockImplementation(() => Promise.reject(offline()));
  }
};
// The app's retry count is cut to none here; with the app's two retries the same happens a few seconds later.
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const mount = (qc: QueryClient, Screen: React.ComponentType) => render(<QueryClientProvider client={qc}><Screen /></QueryClientProvider>);
const failedOnce = (qc: QueryClient, key: QueryKey) => waitFor(() => expect(qc.getQueryState(key)?.status).toBe('error'));
const prepKey = (qc: QueryClient) => qc.getQueryCache().findAll({ queryKey: ['prep-guide'] })[0]!.queryKey;

/**
 * A cold start: what the app's persister writes (queryClient.ts:129-131 saves a query in any state; its serializer cuts
 * the error down), read back into a new client, as the app does at its next start, ten minutes later (so every saved
 * read is older than its page's staleTime and the open reads again).
 */
function coldStart(before: QueryClient): QueryClient {
  const saved = JSON.parse(serializePersistedClient({
    timestamp: Date.now(), buster: 'test', clientState: dehydrate(before, { shouldDehydrateQuery: () => true }),
  }));
  for (const query of saved.clientState.queries) {
    query.state.dataUpdatedAt -= 10 * 60 * 1000;
    query.state.errorUpdatedAt -= 10 * 60 * 1000;
  }
  const after = client();
  hydrate(after, saved.clientState);
  return after;
}

beforeEach(() => {
  jest.clearAllMocks();
  online();
});

describe('GROCERY-OFFLINE-KEEP-M: the Grocery list keeps her list when a re-read fails', () => {
  it('a tick that fails offline keeps every row (the tick is taken back, as before)', async () => {
    const qc = client();
    const view = await mount(qc, GroceryListScreen);
    await view.findByText('Milk');
    goOffline();
    await fireEvent.press(view.getByLabelText('Check Milk'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('milk', { is_checked: true }));
    await failedOnce(qc, KEY); // onSettled read the list again, and that read failed too
    expect(view.queryByText("Couldn't load grocery list.")).toBeNull();
    expect(view.getByText('Milk')).toBeTruthy();
    expect(view.getByText('Eggs')).toBeTruthy();
    expect(view.getByLabelText('Check Milk')).toBeTruthy(); // main's rollback of the tick
    expect(view.getByText('2 to get.')).toBeTruthy();
  });

  it('a remove that fails offline keeps every row (the row comes back, as before)', async () => {
    const qc = client();
    const view = await mount(qc, GroceryListScreen);
    await view.findByText('Milk');
    goOffline();
    await fireEvent.press(view.getByLabelText('Remove Milk'));
    await waitFor(() => expect(listsApi.deleteItem).toHaveBeenCalledWith('milk'));
    await failedOnce(qc, KEY);
    expect(view.queryByText("Couldn't load grocery list.")).toBeNull();
    expect(view.getByText('Milk')).toBeTruthy();
    expect(view.getByText('Eggs')).toBeTruthy();
  });

  it('a cold start on a saved list whose last re-read failed opens on the list, offline', async () => {
    const before = client();
    const first = await mount(before, GroceryListScreen);
    await first.findByText('Milk');
    goOffline();
    await act(async () => { await before.refetchQueries({ queryKey: KEY }); });
    await failedOnce(before, KEY);
    await first.unmount();
    // The app is closed and opened again with no signal.
    const after = coldStart(before);
    expect(after.getQueryState(KEY)?.status).toBe('error');
    expect(after.getQueryData(KEY)).toEqual(rows);
    const reads = jest.mocked(listsApi.getList).mock.calls.length;
    const view = await mount(after, GroceryListScreen);
    expect(view.getByText('Milk')).toBeTruthy();
    expect(view.queryByText("Couldn't load grocery list.")).toBeNull();
    await waitFor(() => expect(listsApi.getList).toHaveBeenCalledTimes(reads + 1)); // the open read the list again
    await failedOnce(after, KEY);
    await act(async () => undefined);
    expect(view.queryByText("Couldn't load grocery list.")).toBeNull();
    expect(view.getByText('Milk')).toBeTruthy();
    expect(view.getByText('Eggs')).toBeTruthy();
  });

  it('with no list on the phone, a failed read still shows the notice and Try again (unchanged)', async () => {
    goOffline();
    const qc = client();
    const view = await mount(qc, GroceryListScreen);
    expect(await view.findByText("Couldn't load grocery list.")).toBeTruthy();
    expect(view.getByText('Try again')).toBeTruthy();
    expect(view.queryByText('Milk')).toBeNull();
    online();
    await fireEvent.press(view.getByText('Try again'));
    expect(await view.findByText('Milk')).toBeTruthy();
    expect(view.queryByText("Couldn't load grocery list.")).toBeNull();
  });
});

describe('GROCERY-OFFLINE-KEEP-M: the Prep guide keeps its recipes when a re-read fails (same class)', () => {
  it('a pull to refresh that fails offline keeps the recipes, the ingredients and Add all', async () => {
    const qc = client();
    const view = await mount(qc, PrepGuideScreen);
    await view.findByText('Soup');
    goOffline();
    await act(async () => { await view.getByTestId('list-scroll').props.refreshControl.props.onRefresh(); });
    await failedOnce(qc, prepKey(qc));
    expect(view.queryByText("Couldn't load prep guide")).toBeNull();
    expect(view.getByText('Soup')).toBeTruthy();
    expect(view.getByText('Carrots')).toBeTruthy();
    expect(view.getByLabelText('Add all ingredients')).toBeTruthy();
  });

  it('a cold start on a saved guide whose last re-read failed opens on the guide, offline', async () => {
    const before = client();
    const first = await mount(before, PrepGuideScreen);
    await first.findByText('Soup');
    const key = prepKey(before);
    goOffline();
    await act(async () => { await before.refetchQueries({ queryKey: key }); });
    await failedOnce(before, key);
    await first.unmount();
    const after = coldStart(before);
    expect(after.getQueryState(key)?.status).toBe('error');
    const reads = jest.mocked(prepGuideApi.getWeeklyGuide).mock.calls.length;
    const view = await mount(after, PrepGuideScreen);
    expect(view.getByText('Soup')).toBeTruthy();
    expect(view.queryByText("Couldn't load prep guide")).toBeNull();
    await waitFor(() => expect(prepGuideApi.getWeeklyGuide).toHaveBeenCalledTimes(reads + 1)); // the open read it again
    await failedOnce(after, key);
    await act(async () => undefined);
    expect(view.queryByText("Couldn't load prep guide")).toBeNull();
    expect(view.getByText('Soup')).toBeTruthy();
  });

  it('with no guide on the phone, a failed read still shows the notice and Try again (unchanged)', async () => {
    goOffline();
    const qc = client();
    const view = await mount(qc, PrepGuideScreen);
    expect(await view.findByText("Couldn't load prep guide")).toBeTruthy();
    expect(view.getByText('Try again')).toBeTruthy();
    expect(view.queryByText('Soup')).toBeNull();
    expect(view.queryByLabelText('Add all ingredients')).toBeNull();
  });
});
