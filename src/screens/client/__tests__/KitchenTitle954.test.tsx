// KITCHEN-TITLE-954: the Style C drawing (ctx#457 shopping-error, shopping-full, prep-plan frames: .mast padding 4,
// .rule margin-top 18, .paper margin-top -24 under the mast's 24 below the rule) puts the Back row 4 pt under the
// status bar and the gold rule 16 pt above the paper. The real screens are mounted in every state they draw the
// masthead in; offsets are summed from the margins and paddings on the host views (first-child chain).
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { listsApi, prepGuideApi, recipesApi } from '../../../services/api';
import GroceryListScreen from '../GroceryListScreen';
import ShoppingListScreen from '../ShoppingListScreen';
import PrepGuideScreen from '../PrepGuideScreen';
import RecipesScreen from '../RecipesScreen';
import RecipeDetailScreen from '../RecipeDetailScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { recipeId: 'soup' } }),
}));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../../../constants/colors').default,
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: [] } }),
}));
jest.mock('../../../lib/recipeAllergens', () => ({
  ...jest.requireActual('../../../lib/recipeAllergens'),
  useRecipeAllergenGuide: () => ({ hiddenNames: [], settled: true }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), bulkAdd: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
  recipesApi: { list: jest.fn(), listSaved: jest.fn(), getById: jest.fn(), save: jest.fn(), unsave: jest.fn() },
  profileApi: { update: jest.fn() },
}));

const recipe = {
  id: 'soup', title: 'Lentil soup', tags: [], ingredients: [], instructions: [],
  calories: 420, protein: 20, carbs: 40, fat: 12, prep_time_min: 10, cook_time_min: 20, servings: 2,
  isSaved: false, allergens_declared: true, allergens: [],
};
const item = { id: 'one', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false };
const guide = (recipes: unknown[]) => ({
  week_start: '2026-11-02', source: 'plan', week_filter_applied: true, prep_day_suggestions: ['Sunday'],
  recipes, aggregated_ingredients: recipes.length ? [{ name: 'Red lentils', quantity: 400, unit: 'g', recipe_ids: ['soup'] }] : [],
});

type State = 'loaded' | 'empty' | 'loading' | 'error';
const never = () => new Promise<never>(() => undefined);
const offline = () => Promise.reject(new Error('offline'));
function serve(state: State) {
  const answer = <T,>(data: T) => (state === 'loading' ? never() : state === 'error' ? offline() : Promise.resolve({ data }));
  jest.mocked(listsApi.getList).mockImplementation(() => answer(state === 'empty' ? [] : [item]) as never);
  jest.mocked(prepGuideApi.getWeeklyGuide).mockImplementation(() => answer(guide(state === 'empty' ? [] : [recipe])) as never);
  jest.mocked(recipesApi.list).mockImplementation(() => answer(state === 'empty' ? [] : [recipe]) as never);
  jest.mocked(recipesApi.listSaved).mockImplementation(() => answer([]) as never);
  jest.mocked(recipesApi.getById).mockImplementation(() => answer(recipe) as never);
}

const SCREENS = {
  Grocery: { Screen: GroceryListScreen, label: 'Back', states: ['loaded', 'empty', 'loading', 'error'] },
  Shopping: { Screen: ShoppingListScreen, label: 'Back', states: ['loaded', 'empty', 'loading', 'error'] },
  Prep: { Screen: PrepGuideScreen, label: 'Back', states: ['loaded', 'empty', 'loading', 'error'] },
  Recipes: { Screen: RecipesScreen, label: 'Go back', states: ['loaded', 'empty', 'loading', 'error'] },
  RecipeDetail: { Screen: RecipeDetailScreen, label: 'Go back', states: ['loaded', 'loading', 'error'] },
} as const;
// iPhone 390 at 100% (47 pt status inset) and the smallest phone at 130% text (20 pt inset).
const SIZES = [
  { size: '390/100', width: 390, height: 844, fontScale: 1, top: 47 },
  { size: '320/130', width: 320, height: 568, fontScale: 1.3, top: 20 },
] as const;
const CASES = (Object.keys(SCREENS) as (keyof typeof SCREENS)[]).flatMap((name) =>
  SCREENS[name].states.flatMap((state) => SIZES.map((size) => [name, state as State, size.size, size] as const)));

type Host = { type: unknown; props: Record<string, unknown> & { style?: unknown }; parent: Host | null; children?: (Host | string)[] };
const flat = (node: Host) => (StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) ?? {}) as Record<string, unknown>;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const isHost = (node: Host | null): node is Host => !!node && typeof node.type === 'string';
const top = (node: Host) => { const st = flat(node); return num(st.marginTop ?? st.marginVertical ?? st.margin); };
const padTop = (node: Host) => { const st = flat(node); return num(st.paddingTop ?? st.paddingVertical ?? st.padding); };
const padBottom = (node: Host) => { const st = flat(node); return num(st.paddingBottom ?? st.paddingVertical ?? st.padding); };
const bottom = (node: Host) => { const st = flat(node); return num(st.marginBottom ?? st.marginVertical ?? st.margin); };
const hostParent = (node: Host) => { let p = node.parent; while (p && !isHost(p)) p = p.parent; return p; };
const hostChildren = (node: Host): Host[] => (node.children ?? []).flatMap((child) =>
  typeof child === 'string' ? [] : isHost(child) ? [child] : hostChildren(child));
/** The node's top below the top edge of `until` (or of the whole tree), from the first-child chain's margins and paddings. */
function topBelow(node: Host, until: Host | null = null): number {
  let sum = 0;
  for (let n: Host | null = node; n && n !== until; n = n.parent) {
    if (!isHost(n)) continue;
    sum += top(n);
    if (n !== node) sum += padTop(n);
  }
  return sum;
}

async function measure(name: keyof typeof SCREENS, state: State, size: (typeof SIZES)[number]) {
  const { Screen, label } = SCREENS[name];
  serve(state);
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: size.width, height: size.height, scale: 1, fontScale: size.fontScale });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const ui = await render(
    <SafeAreaInsetsContext.Provider value={{ top: size.top, bottom: 34, left: 0, right: 0 }}>
      <QueryClientProvider client={client}><Screen /></QueryClientProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  if (state !== 'loading') await waitFor(() => expect(client.isFetching()).toBe(0));
  if (state === 'error') await waitFor(() => expect(ui.getAllByRole('alert').length).toBeGreaterThan(0));
  if (state === 'loaded') await waitFor(() => expect(ui.getAllByText(name === 'Grocery' || name === 'Shopping' ? 'Milk' : 'Lentil soup').length).toBeGreaterThan(0));
  // The masthead's Back comes first in the tree (RecipeDetail's error page also has a "Go back" link on the paper).
  const back = ui.getAllByRole('button', { name: label })[0] as unknown as Host;
  let row: Host | null = back.parent;
  while (row && !(isHost(row) && flat(row).flexDirection === 'row')) row = row.parent;
  const head = hostParent(row!)!;
  const rule = hostChildren(head).slice(-1)[0];
  const siblings = hostChildren(hostParent(head)!);
  const paper = siblings[siblings.indexOf(head) + 1];
  let host: Host | null = row!.parent;
  while (host && !(isHost(host) && /ScrollView/.test(host.type as string))) host = host.parent;
  const save = name === 'RecipeDetail' && state === 'loaded' ? ui.getByRole('button', { name: 'Save recipe' }) as unknown as Host : null;
  return {
    back, row: row!, rule, paper, host, save,
    rowUnderInset: topBelow(row!) - size.top,
    ruleToPaper: bottom(rule) + padBottom(head) + bottom(head) + top(paper),
  };
}

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); jest.restoreAllMocks(); });

describe("KitchenTitle954: on all five kitchen screens the Back row's top sits 4 pt under the status inset and the gold rule sits 16 pt above the paper", () => {
  it.each(CASES)('case 1: %s %s at %s: the Back row top is the status inset + 4', async (name, state, _size, size) => {
    const m = await measure(name, state, size);
    expect(m.rowUnderInset).toBe(4);
  });

  it.each(CASES)('case 2: %s %s at %s: the gold rule sits 16 pt above the paper', async (name, state, _size, size) => {
    const m = await measure(name, state, size);
    expect(flat(m.rule)).toMatchObject({ height: 1 });
    expect(m.ruleToPaper).toBe(16);
  });

  // The words, the 44 pt row and the rule between them are unchanged, so the paper's top is where it was at
  // dd49c6fd exactly when the row's rise and the rule's extra room cancel: 12 + 8 there, 4 + 16 here.
  it.each(CASES)("case 3: %s %s at %s: the paper's top does not move", async (name, state, _size, size) => {
    const m = await measure(name, state, size);
    expect(m.rowUnderInset + m.ruleToPaper).toBe(20);
  });

  it.each(CASES)('case 4: %s %s at %s: the whole 44 pt Back row stays inside its scroll host and the screen', async (name, state, _size, size) => {
    const m = await measure(name, state, size);
    expect(flat(m.back).minHeight).toBeGreaterThanOrEqual(44);
    expect(flat(m.back).minWidth).toBeGreaterThanOrEqual(44);
    expect(m.rowUnderInset).toBeGreaterThanOrEqual(0);
    if (m.host) expect(topBelow(m.row, m.host)).toBeGreaterThanOrEqual(0);
    if (m.save) expect(StyleSheet.flatten(m.save.props.style as Parameters<typeof StyleSheet.flatten>[0]).height).toBeGreaterThanOrEqual(44);
  });
});
