import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi, prepGuideApi } from '../../../services/api';
import { lightTokens, darkTokens } from '../../../theme/tokens';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
let mockTokens = lightTokens;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: mockTokens }),
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
const items = [
  { id: 'milk', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false },
  { id: 'oats', name: 'Oats', quantity: 1, is_checked: true },
];
const guide = {
  recipes: [{ id: 'soup', title: 'Soup', prep_time_min: 10, cook_time_min: 20, servings: 2, calories: 320 }],
  aggregated_ingredients: [{ name: 'Carrots', quantity: 2, unit: 'kg' }],
  prep_day_suggestions: ['Sunday'],
};
const planGuide = { ...guide, source: 'plan' };
// A server that filters by week (NUTR-BE sends week_filter_applied: false for both sources today).
const weekGuide = { ...planGuide, week_filter_applied: true };
type GuideResponse = Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>;
const respond = (data: object) => jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data } as GuideResponse);
function mount(Screen: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
}
async function confirm(label: string) {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => buttons?.find((button) => button.text === label)?.onPress?.());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockTokens = lightTokens;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(listsApi.getList).mockResolvedValue({ data: items } as Awaited<ReturnType<typeof listsApi.getList>>);
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: guide } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
  jest.mocked(listsApi.bulkAdd).mockResolvedValue({ data: { added: 1 } } as Awaited<ReturnType<typeof listsApi.bulkAdd>>);
  for (const method of [listsApi.addItem, listsApi.updateItem, listsApi.deleteItem, listsApi.clearChecked]) jest.mocked(method).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof method>>);
});
describe.each([['grocery', GroceryListScreen], ['shopping', ShoppingListScreen]] as const)('%s action parity', (type, Screen) => {
  it('preserves back, add with quantity/unit, check, uncheck, remove, clear confirmation and refresh', async () => {
    const view = await mount(Screen);
    await view.findByText('Milk');
    expect(view.getByText('1 to get.')).toBeTruthy();
    expect(StyleSheet.flatten(view.getByLabelText('Check Milk').props.style).width).toBe(44);
    await fireEvent.press(view.getByLabelText('Back'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
    await fireEvent.changeText(view.getByPlaceholderText('Add item…'), 'Rice');
    await fireEvent.changeText(view.getByPlaceholderText('Qty'), '3');
    await fireEvent.changeText(view.getByPlaceholderText('Unit'), 'bags');
    await fireEvent.press(view.getByLabelText('Add item'));
    await waitFor(() => expect(listsApi.addItem).toHaveBeenCalledWith(type, { name: 'Rice', quantity: 3, unit: 'bags' }));
    await fireEvent.press(view.getByLabelText('Check Milk'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('milk', { is_checked: true }));
    await fireEvent.press(view.getByLabelText('Uncheck Oats'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('oats', { is_checked: false }));
    await fireEvent.press(view.getByLabelText('Remove Milk'));
    await waitFor(() => expect(listsApi.deleteItem).toHaveBeenCalledWith('milk'));
    await fireEvent.press(view.getByText('Clear checked'));
    await confirm('Cancel');
    expect(listsApi.clearChecked).not.toHaveBeenCalled();
    await confirm('Clear');
    await waitFor(() => expect(listsApi.clearChecked).toHaveBeenCalledWith(type));
    await act(async () => view.getByTestId('list-scroll').props.refreshControl.props.onRefresh());
    await waitFor(() => expect(jest.mocked(listsApi.getList).mock.calls.length).toBeGreaterThan(1));
  });
  it('offers a working recovery action rather than an unavailable pull gesture', async () => {
    jest.mocked(listsApi.getList).mockRejectedValue(new Error('offline'));
    const view = await mount(Screen);
    await fireEvent.press(await view.findByText('Try again'));
    await waitFor(() => expect(listsApi.getList).toHaveBeenCalledTimes(2));
  });
  it.each([false, true])('shows only a data-backed summary for empty/all-checked states (%s)', async (allChecked) => {
    jest.mocked(listsApi.getList).mockResolvedValue({ data: allChecked ? [items[1]] : [] } as Awaited<ReturnType<typeof listsApi.getList>>);
    const view = await mount(Screen);
    await view.findByText(allChecked ? 'All items checked.' : `Your ${type} list is empty`);
    expect(view.queryByText('1 to get.')).toBeNull();
  });
});
it('preserves prep back, both week arrows, refresh, add/cancel and success grocery navigation', async () => {
  respond(weekGuide);
  const view = await mount(PrepGuideScreen);
  await view.findByText('Soup');
  expect(view.getByText('Sunday')).toBeTruthy();
  expect(view.getByText('30 min')).toBeTruthy();
  expect(view.queryByText(/keep fresh food ready/)).toBeNull();
  await fireEvent.press(view.getByLabelText('Back'));
  await fireEvent.press(view.getByLabelText('Previous week'));
  await waitFor(() => expect(prepGuideApi.getWeeklyGuide).toHaveBeenCalledTimes(2));
  await fireEvent.press(view.getByLabelText('Next week'));
  await act(async () => view.getByTestId('list-scroll').props.refreshControl.props.onRefresh());
  await fireEvent.press(await view.findByText('Add all'));
  await confirm('Cancel');
  expect(listsApi.bulkAdd).not.toHaveBeenCalled();
  await confirm('Add');
  await waitFor(() => expect(listsApi.bulkAdd).toHaveBeenCalledWith('grocery', [{ name: 'Carrots', quantity: 2, unit: 'kg' }]));
  await waitFor(() => expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[0]).toBe('Added to Grocery List'));
  await confirm('View List');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('GroceryList');
});
it('uses neutral empty/loading copy and disables Add all when there are no ingredients', async () => {
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: { ...guide, aggregated_ingredients: [] } } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
  const view = await mount(PrepGuideScreen);
  expect(view.queryByText('Building your prep guide…')).toBeNull();
  await view.findByText('Soup');
  expect(view.getByText('Add all')).toBeDisabled();
  await view.unmount();
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: { ...guide, recipes: [] } } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
  const empty = await mount(PrepGuideScreen);
  await empty.findByText('No recipes yet');
  expect(empty.getByText('Recipes from a meal plan or available to this account appear here.')).toBeTruthy();
  expect(empty.queryByText(/Ask your coach|selected week/)).toBeNull();
});
it('describes fetching the prep guide without claiming it is being built', async () => {
  jest.mocked(prepGuideApi.getWeeklyGuide).mockReturnValue(new Promise(() => {}));
  const view = await mount(PrepGuideScreen);
  expect(view.getByText('Loading your prep guide…')).toBeTruthy();
});
it.each([GroceryListScreen, ShoppingListScreen, PrepGuideScreen])('uses semantic page colors in dark mode', async (Screen) => {
  mockTokens = darkTokens;
  const view = await mount(Screen);
  expect(StyleSheet.flatten(view.getByTestId('grocery-prep-screen').props.style).backgroundColor).toBe(darkTokens.bgPrimary);
});

describe('prep guide says where its recipes come from (NUTR-AUD-128 B1)', () => {
  it('library source: says none come from a meal plan, with no week or prep-day claims', async () => {
    respond({ ...guide, source: 'library', week_filter_applied: false });
    const view = await mount(PrepGuideScreen);
    await view.findByText('Soup');
    expect(view.getByText('1 recipe available to this account.')).toBeTruthy();
    expect(view.getByText('None of these come from a meal plan.')).toBeTruthy();
    expect(view.getByText('Recipes (1)')).toBeTruthy();
    expect(view.queryByText(/for the week|Recipes to prep|from your meal plan/)).toBeNull();
    expect(view.queryByText('Sunday')).toBeNull();
    expect(view.queryByLabelText('Previous week')).toBeNull();
    expect(view.queryByLabelText('Next week')).toBeNull();
    await fireEvent.press(view.getByText('Add all'));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toBe('Add 1 ingredient from these recipes to your grocery list?');
  });
  it('unknown source (a backend that may return plan recipes without saying so): neutral, never denies a meal plan', async () => {
    respond(guide);
    const view = await mount(PrepGuideScreen);
    await view.findByText('Soup');
    expect(view.getByText('1 recipe available to this account.')).toBeTruthy();
    expect(view.getByText('Recipes (1)')).toBeTruthy();
    expect(view.queryByText(/None of these|from your meal plan|Recipes to prep|for the week/)).toBeNull();
    expect(view.queryByText('Sunday')).toBeNull();
    expect(view.queryByLabelText('Previous week')).toBeNull();
  });
  it('plan source: names the meal plan and keeps suggested days', async () => {
    respond(planGuide);
    const view = await mount(PrepGuideScreen);
    await view.findByText('Soup');
    expect(view.getByText('1 recipe from your meal plan.')).toBeTruthy();
    expect(view.getByText('Recipes to prep (1)')).toBeTruthy();
    expect(view.getByText('Sunday')).toBeTruthy();
    expect(view.queryByText(/None of these/)).toBeNull();
  });
});
describe('the week selector shows only where the server filters by week (Sol U1)', () => {
  it.each([[undefined], [false]])('plan source with week_filter_applied %s: no week arrows (they would change nothing)', async (applied) => {
    respond({ ...planGuide, week_filter_applied: applied });
    const view = await mount(PrepGuideScreen);
    await view.findByText('1 recipe from your meal plan.');
    expect(view.queryByLabelText('Previous week')).toBeNull();
    expect(view.queryByLabelText('Next week')).toBeNull();
    expect(view.queryByText('This week')).toBeNull();
  });
  it('week_filter_applied true: shows the week selector', async () => {
    respond(weekGuide);
    const view = await mount(PrepGuideScreen);
    await view.findByText('Soup');
    expect(view.getByLabelText('Previous week')).toBeTruthy();
    expect(view.getByLabelText('Next week')).toBeTruthy();
    expect(view.getByText('This week')).toBeTruthy();
  });
  it('keeps the week selector after leaving the current week so the client can come back', async () => {
    respond(weekGuide);
    const view = await mount(PrepGuideScreen);
    await view.findByText('Soup');
    respond({ ...guide, source: 'library', week_filter_applied: false });
    await fireEvent.press(view.getByLabelText('Next week'));
    await view.findByText('None of these come from a meal plan.');
    await fireEvent.press(view.getByLabelText('Previous week'));
    const calls = jest.mocked(prepGuideApi.getWeeklyGuide).mock.calls;
    await waitFor(() => expect(calls.length).toBeGreaterThan(2));
    expect(calls.at(-1)?.[0]).toBe(calls[0][0]);
  });
});
describe('Add all adds once (NUTR-AUD-128 U3)', () => {
  it('sends every ingredient in one bulk request and reports the server count', async () => {
    respond({ ...guide, aggregated_ingredients: [{ name: 'Carrots', quantity: 2, unit: 'kg' }, { name: 'Salt', quantity: 0, unit: '' }] });
    jest.mocked(listsApi.bulkAdd).mockResolvedValue({ data: { added: 2 } } as Awaited<ReturnType<typeof listsApi.bulkAdd>>);
    const view = await mount(PrepGuideScreen);
    await fireEvent.press(await view.findByText('Add all'));
    await confirm('Add');
    await waitFor(() => expect(listsApi.bulkAdd).toHaveBeenCalledTimes(1));
    expect(listsApi.bulkAdd).toHaveBeenCalledWith('grocery', [{ name: 'Carrots', quantity: 2, unit: 'kg' }, { name: 'Salt', quantity: 0, unit: undefined }]);
    expect(listsApi.addItem).not.toHaveBeenCalled();
    await waitFor(() => expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toBe('2 ingredients added to your grocery list.'));
  });
  it('says nothing was added when the single request fails', async () => {
    jest.mocked(listsApi.bulkAdd).mockRejectedValue(new Error('offline'));
    const view = await mount(PrepGuideScreen);
    await fireEvent.press(await view.findByText('Add all'));
    await confirm('Add');
    await waitFor(() => expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[0]).toBe('Could not add the ingredients'));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toBe('Nothing was added to your grocery list. Try again.');
  });
});
it('opens a prep recipe in Recipe detail', async () => {
  const view = await mount(PrepGuideScreen);
  await fireEvent.press(await view.findByLabelText('Open Soup'));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('RecipeDetail', { recipeId: 'soup' });
});
