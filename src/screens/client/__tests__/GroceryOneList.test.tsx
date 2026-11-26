/**
 * CF-ONE-LIST-128, then SHOP-SWITCH-M (owner 203-D16 op 1): the grocery screen reads both lists once and shows one at
 * a time. Rows a client saved on the Shopping list show on its Shopping tab and keep every action.
 */
import React from 'react';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi } from '../../../services/api';
import { lightTokens } from '../../../theme/tokens';
import GroceryListScreen from '../GroceryListScreen';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
// The Style C masthead paints the status bar on focus; no navigator here (STYLE-KITCHEN-M).
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
  listsApi: { getList: jest.fn(), addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
}));

type Row = { id: string; name: string; quantity: number; unit?: string; is_checked: boolean };
type ListResponse = Awaited<ReturnType<typeof listsApi.getList>>;
const grocery: Row[] = [
  { id: 'milk', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false },
  { id: 'oats', name: 'Oats', quantity: 1, is_checked: true },
];
const shopping: Row[] = [
  { id: 'towels', name: 'Paper towels', quantity: 1, is_checked: false },
  { id: 'soap', name: 'Soap', quantity: 1, is_checked: true },
];
const NOTE = 'Includes items from your shopping list.';

function serve(lists: { grocery: Row[] | Error; shopping: Row[] | Error }) {
  jest.mocked(listsApi.getList).mockImplementation((type) => {
    const rows = lists[type];
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ data: rows } as ListResponse);
  });
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><GroceryListScreen /></QueryClientProvider>);
}
async function confirm(label: string) {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => buttons?.find((button) => button.text === label)?.onPress?.());
}
const readsOf = (type: string) => jest.mocked(listsApi.getList).mock.calls.filter(([t]) => t === type).length;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  serve({ grocery, shopping });
  const mutationResponse = {
    data: {},
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  } satisfies AxiosResponse<Record<string, never>>;
  for (const method of [listsApi.addItem, listsApi.updateItem, listsApi.deleteItem, listsApi.clearChecked]) {
    jest.mocked(method).mockResolvedValue(mutationResponse);
  }
});

describe('One read, two lists on the grocery screen (CF-ONE-LIST-128, SHOP-SWITCH-M)', () => {
  it('shows the grocery rows on the Grocery tab, each counted once, beside each list\'s own count; no note', async () => {
    const view = await mount();
    await view.findByText('Milk');
    for (const name of ['Milk', 'Oats']) expect(view.getAllByText(name)).toHaveLength(1);
    for (const name of ['Paper towels', 'Soap']) expect(view.queryByText(name)).toBeNull();
    expect(view.getByText('1 to get.')).toBeTruthy();
    expect(view.getByText('To get (1)')).toBeTruthy();
    expect(view.getByText('Checked (1)')).toBeTruthy();
    // SHOP-SWITCH-M (ctx#527 style 1): the switch says which list shows (W14 removes the note); the chosen tab is bone.
    expect(view.queryByText(NOTE)).toBeNull();
    expect(view.getByRole('tab', { name: 'Grocery, 1 to get' })).toHaveStyle({ backgroundColor: lightTokens.textOnAccent });
    expect(view.getByRole('tab', { name: 'Shopping, 1 to get' })).toBeTruthy();
    expect(view.getByText('Grocery list')).toBeTruthy();
    expect(listsApi.getList).toHaveBeenCalledWith('grocery');
    expect(listsApi.getList).toHaveBeenCalledWith('shopping');
  });

  it('checks, unchecks and removes a row that came from the shopping list, on the Shopping tab', async () => {
    const view = await mount();
    await view.findByText('Milk');
    await fireEvent.press(view.getByRole('tab', { name: 'Shopping, 1 to get' }));
    await fireEvent.press(view.getByLabelText('Check Paper towels'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('towels', { is_checked: true }));
    await fireEvent.press(view.getByLabelText('Uncheck Soap'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('soap', { is_checked: false }));
    await fireEvent.press(view.getByLabelText('Remove Paper towels'));
    await waitFor(() => expect(listsApi.deleteItem).toHaveBeenCalledWith('towels'));
  });

  it('Clear checked clears only the list on show, even when the other list has a checked row', async () => {
    const view = await mount();
    await view.findByText('Oats');
    await fireEvent.press(view.getByText('Clear checked'));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toBe('Remove 1 checked item?');
    await confirm('Clear');
    await waitFor(() => expect(listsApi.clearChecked).toHaveBeenCalledWith('grocery'));
    expect(listsApi.clearChecked).toHaveBeenCalledTimes(1);
    expect(listsApi.clearChecked).not.toHaveBeenCalledWith('shopping');
  });

  it('Clear checked touches only the grocery list when no checked row came from the shopping list', async () => {
    serve({ grocery, shopping: [shopping[0]] });
    const view = await mount();
    await view.findByText('Milk');
    await fireEvent.press(view.getByText('Clear checked'));
    await confirm('Clear');
    await waitFor(() => expect(listsApi.clearChecked).toHaveBeenCalledWith('grocery'));
    expect(listsApi.clearChecked).toHaveBeenCalledTimes(1);
  });

  it('adds new rows to the grocery list', async () => {
    const view = await mount();
    await view.findByText('Milk');
    await fireEvent.changeText(view.getByPlaceholderText('Add item…'), 'Rice');
    await fireEvent.press(view.getByLabelText('Add item'));
    await waitFor(() => expect(listsApi.addItem).toHaveBeenCalledWith('grocery', { name: 'Rice', quantity: 1, unit: undefined }));
    expect(listsApi.addItem).not.toHaveBeenCalledWith('shopping', expect.anything());
  });

  it('says nothing about the shopping list when it holds no rows', async () => {
    serve({ grocery, shopping: [] });
    const view = await mount();
    await view.findByText('Milk');
    expect(view.getByText('1 to get.')).toBeTruthy();
    expect(view.queryByText(NOTE)).toBeNull();
  });

  it('an empty grocery list shows its empty words beside the Shopping count, also when both lists are empty', async () => {
    serve({ grocery: [], shopping: [shopping[0]] });
    const view = await mount();
    await view.findByText('Your grocery list is empty');
    expect(view.getByRole('tab', { name: 'Shopping, 1 to get' })).toBeTruthy();
    expect(view.queryByText('Paper towels')).toBeNull();
    await view.unmount();
    serve({ grocery: [], shopping: [] });
    const empty = await mount();
    await empty.findByText('Your grocery list is empty');
    expect(empty.queryByText(NOTE)).toBeNull();
  });

  it('a failed shopping read shows Try again, which reads both lists again', async () => {
    serve({ grocery, shopping: new Error('offline') });
    const view = await mount();
    await view.findByText("Couldn't load grocery list.");
    expect(view.queryByText('Milk')).toBeNull();
    serve({ grocery, shopping });
    await fireEvent.press(view.getByText('Try again'));
    await view.findByText('Milk');
    expect(readsOf('grocery')).toBe(2);
    expect(readsOf('shopping')).toBe(2);
  });

  it('a failed grocery read does not also read the shopping list', async () => {
    serve({ grocery: new Error('offline'), shopping });
    const view = await mount();
    await view.findByText('Try again');
    expect(readsOf('grocery')).toBe(1);
    expect(readsOf('shopping')).toBe(0);
  });
});
