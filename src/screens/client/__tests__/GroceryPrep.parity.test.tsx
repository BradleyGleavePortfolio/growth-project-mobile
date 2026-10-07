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
  listsApi: { getList: jest.fn(), addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
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
  expect(listsApi.addItem).not.toHaveBeenCalled();
  await confirm('Add');
  await waitFor(() => expect(listsApi.addItem).toHaveBeenCalledWith('grocery', { name: 'Carrots', quantity: 2, unit: 'kg' }));
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
  await empty.findByText('No recipes to prep');
  expect(empty.queryByText(/Ask your coach/)).toBeNull();
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
