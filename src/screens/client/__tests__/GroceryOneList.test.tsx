/**
 * CF-ONE-LIST-128 (owner 10-07: "merge them / cut one and keep one"): Grocery is the one list.
 * Rows a client saved on the retired Shopping list show here and keep every Grocery action.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi } from '../../../services/api';
import { lightTokens } from '../../../theme/tokens';
import GroceryListScreen from '../GroceryListScreen';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
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
  for (const method of [listsApi.addItem, listsApi.updateItem, listsApi.deleteItem, listsApi.clearChecked]) {
    jest.mocked(method).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof method>>);
  }
});

describe('Grocery is the one list (CF-ONE-LIST-128)', () => {
  it('shows rows saved on the shopping list next to grocery rows, counted once, with one quiet note', async () => {
    const view = await mount();
    await view.findByText('Paper towels');
    for (const name of ['Milk', 'Oats', 'Paper towels', 'Soap']) expect(view.getAllByText(name)).toHaveLength(1);
    expect(view.getByText('2 to get.')).toBeTruthy();
    expect(view.getByText('To get (2)')).toBeTruthy();
    expect(view.getByText('Checked (2)')).toBeTruthy();
    expect(view.getByText(NOTE)).toHaveStyle({ color: lightTokens.textMuted, fontFamily: 'Inter_400Regular' });
    expect(view.getByText('Grocery list')).toBeTruthy();
    expect(listsApi.getList).toHaveBeenCalledWith('grocery');
    expect(listsApi.getList).toHaveBeenCalledWith('shopping');
  });

  it('checks, unchecks and removes a row that came from the shopping list', async () => {
    const view = await mount();
    await view.findByText('Paper towels');
    await fireEvent.press(view.getByLabelText('Check Paper towels'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('towels', { is_checked: true }));
    await fireEvent.press(view.getByLabelText('Uncheck Soap'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('soap', { is_checked: false }));
    await fireEvent.press(view.getByLabelText('Remove Paper towels'));
    await waitFor(() => expect(listsApi.deleteItem).toHaveBeenCalledWith('towels'));
  });

  it('Clear checked clears both lists when a checked row came from the shopping list', async () => {
    const view = await mount();
    await view.findByText('Soap');
    await fireEvent.press(view.getByText('Clear checked'));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toBe('Remove 2 checked items?');
    await confirm('Clear');
    await waitFor(() => expect(listsApi.clearChecked).toHaveBeenCalledTimes(2));
    expect(listsApi.clearChecked).toHaveBeenCalledWith('grocery');
    expect(listsApi.clearChecked).toHaveBeenCalledWith('shopping');
  });

  it('Clear checked touches only the grocery list when no checked row came from the shopping list', async () => {
    serve({ grocery, shopping: [shopping[0]] });
    const view = await mount();
    await view.findByText('Paper towels');
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

  it('shows shopping rows even when the grocery list is empty, and the empty state only when both are', async () => {
    serve({ grocery: [], shopping: [shopping[0]] });
    const view = await mount();
    await view.findByText('Paper towels');
    expect(view.getByText('1 to get.')).toBeTruthy();
    expect(view.queryByText('Your grocery list is empty')).toBeNull();
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
    await view.findByText('Paper towels');
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
