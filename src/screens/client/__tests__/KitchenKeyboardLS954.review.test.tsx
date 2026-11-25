import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import { listsApi } from '../../../services/api';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
}));

type Responder = {
  _isAnimating: () => boolean;
  _keyboardIsDismissible: () => boolean;
  _softKeyboardIsDetached: () => boolean;
  _handleStartShouldSetResponderCapture: (event: { target: object }) => boolean;
};
type Ancestor = { type: unknown; props: Record<string, unknown>; parent: Ancestor | null };

// Use the installed RN responder, not the preset's ScrollView mock or a
// reimplementation of the keyboardShouldPersistTaps decision. Native input
// and keyboard presence are explicit preconditions; no device claim is made.
function firstTapCapturedByScrollView(node: Ancestor): boolean {
  const actual = jest.requireActual('react-native/Libraries/Components/ScrollView/ScrollView').default as
    (props: Record<string, unknown>) => React.ReactElement;
  let ancestor = node.parent;
  while (ancestor) {
    if (ancestor.type === 'RCTScrollView') {
      const element = actual(ancestor.props);
      const NativeScrollView = element.type as unknown as new (props: Record<string, unknown>) => Responder;
      const instance = new NativeScrollView(ancestor.props);
      instance._isAnimating = () => false;
      instance._keyboardIsDismissible = () => true;
      instance._softKeyboardIsDetached = () => false;
      if (instance._handleStartShouldSetResponderCapture({ target: {} })) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

const clients: QueryClient[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listsApi.getList).mockResolvedValue({ data: [] } as Awaited<ReturnType<typeof listsApi.getList>>);
});
afterEach(() => clients.splice(0).forEach(client => client.clear()));

it.each([['grocery', GroceryListScreen], ['shopping', ShoppingListScreen]] as const)(
  'B1: %s Add receives the first tap while its text-input keyboard is open',
  async (_kind, Screen) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    clients.push(client);
    const ui = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
    await waitFor(() => expect(ui.getByText(/Your (grocery|shopping) list is empty/)).toBeTruthy());
    await fireEvent.changeText(ui.getByPlaceholderText('Add item…'), 'Bread');
    const add = ui.getByRole('button', { name: 'Add item' });
    expect(add.props.accessibilityState?.disabled ?? add.props.disabled).toBe(false);
    expect(firstTapCapturedByScrollView(add as unknown as Ancestor)).toBe(false);
  },
);
