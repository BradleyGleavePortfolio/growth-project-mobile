import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({
  listsApi: {
    getList: jest.fn(async () => ({ data: [] })),
    addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn(),
  },
}));

// Android's ordinary Small text preset is 0.85. Text may shrink, but the
// physical input hit target must retain the job's 44pt minimum.
// Render both actual consumers because Shopping imports Grocery's list styles.
describe.each([['Grocery', GroceryListScreen], ['Shopping', ShoppingListScreen]] as const)(
  'B1 LS-954R2: %s input targets',
  (_name, Screen) => {
    describe.each([0.85, 1, 1.3])('at font scale %s', (fontScale) => {
      it.each(['Add item…', 'Qty', 'Unit'])('%s retains a 44pt touch target', async (placeholder) => {
        const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
          width: 320, height: 568, scale: 1, fontScale,
        });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const ui = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
        try {
          const input = ui.getByPlaceholderText(placeholder);
          const style = StyleSheet.flatten(input.props.style);
          expect(Math.max(style.height ?? 0, style.minHeight ?? 0)).toBeGreaterThanOrEqual(44);
          if (typeof style.width === 'number') {
            expect(Math.max(style.width, style.minWidth ?? 0)).toBeGreaterThanOrEqual(44);
          }
        } finally {
          await ui.unmount();
          client.clear();
          dimensions.mockRestore();
        }
      });
    });
  },
);
