// LO-954R2 (Opus lens, m#954 @ 9e1d06ad) B-TEST: fails at the reviewed head. On iOS, RefreshControl's refreshing prop
// going true by program moves the page (RCTPullToRefreshViewComponentView beginRefreshingProgrammatically). Now the
// masthead and add form live in the list, so a tick, a remove or an add must not turn the pull spinner on.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi } from '../../../services/api';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
}));

const rows = [
  { id: 'one', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false, added_at: '2026-11-01' },
  { id: 'two', name: 'Eggs', quantity: 1, is_checked: false, added_at: '2026-11-01' },
];
const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach((c) => c.clear()); jest.clearAllMocks(); });

const cases: Array<[string, 'a tick' | 'a remove' | 'an add', React.ComponentType]> = [
  ['Grocery', 'a tick', GroceryListScreen], ['Grocery', 'a remove', GroceryListScreen], ['Grocery', 'an add', GroceryListScreen],
  ['Shopping', 'a tick', ShoppingListScreen], ['Shopping', 'a remove', ShoppingListScreen], ['Shopping', 'an add', ShoppingListScreen],
];

it.each(cases)('B1 LO-954R2: on the %s list, %s does not turn the pull spinner on while the list reloads', async (_name, action, Screen) => {
  let hold = false;
  jest.mocked(listsApi.getList).mockImplementation(() =>
    (hold ? new Promise(() => undefined) : Promise.resolve({ data: rows })) as ReturnType<typeof listsApi.getList>);
  jest.mocked(listsApi.updateItem).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof listsApi.updateItem>>);
  jest.mocked(listsApi.deleteItem).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof listsApi.deleteItem>>);
  jest.mocked(listsApi.addItem).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof listsApi.addItem>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const ui = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await waitFor(() => expect(ui.getAllByText('Milk').length).toBeGreaterThan(0));
  const spinner = () => (ui.getByTestId('list-scroll').props.refreshControl as React.ReactElement<{ refreshing: boolean }>).props.refreshing;
  expect(spinner()).toBe(false);

  const before = jest.mocked(listsApi.getList).mock.calls.length;
  hold = true;
  if (action === 'a tick') await fireEvent.press(ui.getByRole('checkbox', { name: 'Check Milk' }));
  if (action === 'a remove') await fireEvent.press(ui.getByRole('button', { name: 'Remove Milk' }));
  if (action === 'an add') {
    await fireEvent.changeText(ui.getByPlaceholderText('Add item…'), 'Bread');
    await fireEvent.press(ui.getByRole('button', { name: 'Add item' }));
  }
  // The reload the action's invalidate starts is now in flight (held open above).
  await waitFor(() => expect(jest.mocked(listsApi.getList).mock.calls.length).toBeGreaterThan(before));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(spinner()).toBe(false);
});
