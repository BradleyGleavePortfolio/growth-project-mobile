// LO-954R2 (Opus lens, m#954 @ 9e1d06ad) B-TEST: fails at the reviewed head. ctx#457 frames shopping-error draw Try again
// 16 pt under the notice (margin-top:16px); main had gap 16; the head shares the loading text's 4 pt gap with the error block.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
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
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
}));

type Node = { type: unknown; props: { style?: unknown }; parent: Node | null };

it.each([['Grocery', GroceryListScreen], ['Shopping', ShoppingListScreen]] as const)(
  'B2 LO-954R2: the %s error state keeps Try again 16 pt under the notice, as drawn',
  async (_name, Screen) => {
    jest.mocked(listsApi.getList).mockRejectedValue(new Error('offline'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const ui = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
    await waitFor(() => expect(ui.getByRole('button', { name: 'Try again' })).toBeTruthy());
    let block = (ui.getByRole('alert') as unknown as Node).parent;
    while (block && typeof block.type !== 'string') block = block.parent;
    const style = StyleSheet.flatten(block?.props.style as Parameters<typeof StyleSheet.flatten>[0]) as { gap?: number };
    expect(style.gap).toBe(16);
    client.clear();
  },
);
