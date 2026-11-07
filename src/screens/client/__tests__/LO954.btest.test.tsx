// LO-954 (Opus lens, m#954 @ faabff0c) B-TESTs: each fails at the reviewed head and passes on main 738bbce0's layout.
import React from 'react';
import { Dimensions } from 'react-native';
import { render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi, prepGuideApi } from '../../../services/api';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), bulkAdd: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
}));

const item = { id: 'one', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false };
const guide = {
  week_start: '2026-11-02', source: 'plan', week_filter_applied: true, prep_day_suggestions: ['Sunday'],
  recipes: [{ id: 'soup', title: 'Lentil soup', prep_time_min: 10, cook_time_min: 20, servings: 2, calories: 420, allergens_declared: true, allergens: [] }],
  aggregated_ingredients: [{ name: 'Red lentils', quantity: 400, unit: 'g', recipe_ids: ['soup'] }],
};
const clients: QueryClient[] = [];
async function mount(Screen: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 320, height: 568, scale: 1, fontScale: 1.3 });
  jest.mocked(listsApi.getList).mockResolvedValue({ data: [item] } as Awaited<ReturnType<typeof listsApi.getList>>);
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: guide } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
});
afterEach(() => { clients.splice(0).forEach((c) => c.clear()); jest.restoreAllMocks(); });

it.each([
  ['Grocery list', GroceryListScreen],
  ['Shopping list', ShoppingListScreen],
] as const)('B1 LO-954: the %s add form now scrolls with the list, so its scroll view must let a tap on Add item through while the keyboard is up', async (_name, Screen) => {
  const ui = await mount(Screen);
  await waitFor(() => expect(ui.getAllByText('Milk').length).toBeGreaterThan(0));
  const scroll = ui.getByTestId('list-scroll');
  // The add form (and its Add item button) is inside this scroll view at the head; on main it sat outside it.
  expect(within(scroll).getByLabelText('Add item')).toBeTruthy();
  // RN default 'never': with the keyboard up, the first tap on Add item only dismisses the keyboard.
  expect(['handled', 'always']).toContain(scroll.props.keyboardShouldPersistTaps);
});
