// REFINE-959 (fix round 1 on m#959): the kitchen screens follow the Style C kitchen drawings (ctx#457 KITCHEN-929
// frames @ 119dbbef; C2 style-c C_recipe @ a9434a53 where ctx#457 draws no recipe page) on what the earlier rounds left
// as notes. Each case mounts the real screen (KitchenTitle954's mocks) at iPhone 390 / 100% and 320 x 568 / 130% and
// checks the drawing's own number, quoted from the frame's CSS beside it. Colours the theme cannot hit exactly are an
// alpha of an existing token over the paper (#F7FAF7, owner #197-E6); each case says how close the drawing allows.
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { listsApi, prepGuideApi, recipesApi } from '../../../services/api';
import { gold } from '../../../theme/tokens';
import { StyleCSheet } from '../../../ui/layout/StyleCPage';
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
// Each glyph is a host node named by its icon, so a case can see which glyph a screen draws.
jest.mock('@expo/vector-icons', () => {
  const ReactActual = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { Ionicons: ({ name }: { name: string }) => ReactActual.createElement(View, { testID: `icon-${name}` }) };
});
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
  id: 'soup', title: 'Lentil soup', tags: [], ingredients: ['Red lentils'], instructions: ['Simmer.'],
  calories: 420, protein: 20, carbs: 40, fat: 12, prep_time_min: 10, cook_time_min: 20, servings: 2,
  isSaved: false, allergens_declared: true, allergens: [],
};
const items = [
  { id: 'one', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false },
  { id: 'two', name: 'Eggs', quantity: 6, unit: 'eggs', is_checked: true },
];
const guide = (recipes: unknown[]) => ({
  week_start: '2026-11-02', source: 'plan', week_filter_applied: true, prep_day_suggestions: ['Sunday'],
  recipes, aggregated_ingredients: recipes.length ? [{ name: 'Red lentils', quantity: 400, unit: 'g', recipe_ids: ['soup'] }] : [],
});

type State = 'loaded' | 'empty' | 'loading' | 'error';
const never = () => new Promise<never>(() => undefined);
const offline = () => Promise.reject(new Error('offline'));
function serve(state: State) {
  const answer = <T,>(data: T) => (state === 'loading' ? never() : state === 'error' ? offline() : Promise.resolve({ data }));
  jest.mocked(listsApi.getList).mockImplementation(() => answer(state === 'empty' ? [] : items) as never);
  jest.mocked(prepGuideApi.getWeeklyGuide).mockImplementation(() => answer(guide(state === 'empty' ? [] : [recipe])) as never);
  jest.mocked(recipesApi.list).mockImplementation(() => answer(state === 'empty' ? [] : [recipe]) as never);
  jest.mocked(recipesApi.listSaved).mockImplementation(() => answer([]) as never);
  jest.mocked(recipesApi.getById).mockImplementation(() => answer(recipe) as never);
}

const SIZES = [
  { size: '390/100', width: 390, height: 844, fontScale: 1, top: 47 },
  { size: '320/130', width: 320, height: 568, fontScale: 1.3, top: 20 },
] as const;
type Size = (typeof SIZES)[number];
const EACH = SIZES.map((s) => [s.size, s] as const);

type Host = { type: unknown; props: Record<string, unknown> & { style?: unknown }; parent: Host | null; children?: (Host | string)[] };
const flat = (node: Host | null | undefined) => (StyleSheet.flatten((node?.props.style ?? {}) as Parameters<typeof StyleSheet.flatten>[0]) ?? {}) as Record<string, unknown>;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const isHost = (node: Host | null): boolean => !!node && typeof node.type === 'string';
const hostParent = (node: Host) => { let p = node.parent; while (p && !isHost(p)) p = p.parent; return p; };
function hosts(node: Host): Host[] {
  return (node.children ?? []).flatMap((child) => (typeof child === 'string' ? [] : [...(isHost(child) ? [child] : []), ...hosts(child)]));
}

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); jest.restoreAllMocks(); });

async function mount(Screen: React.ComponentType, state: State, size: Size) {
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
  return ui;
}

// A colour as drawn on the paper: hex, or an rgba() laid over #F7FAF7.
const PAPER = [0xf7, 0xfa, 0xf7];
function onPaper(colour: unknown): number[] {
  const text = String(colour);
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(text);
  if (!m) throw new Error(`not a colour: ${text}`);
  const a = Number(m[4]);
  return [1, 2, 3].map((i, k) => Number(m[i]) * a + PAPER[k] * (1 - a));
}
const furthest = (colour: unknown, drawn: string) => Math.max(...onPaper(colour).map((v, i) => Math.abs(v - onPaper(drawn)[i])));
function contrast(fg: string, bg: string) {
  const lum = (hex: string) => {
    const [r, g, b] = onPaper(hex).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe.each([['Grocery', GroceryListScreen], ['Shopping', ShoppingListScreen]] as const)('%s list rows', (_name, Screen) => {
  it.each(EACH)('D1: the cross sits at the gutter and the amount ends 50 pt in, as drawn (%s)', async (_s, size) => {
    // shopping-partly: .rm{width:44px;height:44px;display:flex;align-items:center;justify-content:flex-end;flex:none}
    // .srow{display:flex;align-items:center;gap:6px;...}: the amount's right edge is 44 + 6 = 50 pt from the paper's gutter.
    const ui = await mount(Screen, 'loaded', size);
    await waitFor(() => expect(ui.getByText('Milk')).toBeTruthy());
    const remove = ui.getByRole('button', { name: 'Remove Milk' }) as unknown as Host;
    const box = flat(remove);
    expect(box.width).toBe(44);
    expect(box.alignItems).toBe('flex-end');
    const row = hostParent(remove)!;
    expect(num(box.marginRight ?? box.marginHorizontal ?? box.margin) * -1 + num(box.width) + num(flat(row).gap)).toBe(50);
  });

  it.each(EACH)('D2: "Clear checked" starts at the 24 pt gutter (%s)', async (_s, size) => {
    // shopping-partly: .scroll{padding:22px 24px 0} .clear{display:inline-block;...;padding:16px 0}: the words start at 24.
    const ui = await mount(Screen, 'loaded', size);
    const link = await waitFor(() => ui.getByRole('button', { name: 'Clear checked' })) as unknown as Host;
    const st = flat(link);
    expect(num(st.marginLeft ?? st.marginHorizontal ?? st.margin) + num(st.paddingLeft ?? st.paddingHorizontal ?? st.padding)).toBe(24);
  });

  it.each(EACH)('D3: the Qty and Unit underlines are the drawn #B9B2A7 (%s)', async (_s, size) => {
    // shopping-partly: .fld.sm{border-bottom-color:#B9B2A7;...}; stone at 0.9 over the paper is within 2 of it per channel.
    const ui = await mount(Screen, 'loaded', size);
    for (const field of ['Qty', 'Unit']) expect(furthest(flat(ui.getByPlaceholderText(field) as unknown as Host).borderColor, '#B9B2A7')).toBeLessThanOrEqual(2);
  });

  it.each(EACH)('D5-D6: the loading rows draw the frame\'s lighter line and ring (%s)', async (_s, size) => {
    // shopping-loading: .lines .l{...;border-bottom:1px solid #ECE7DF} and the ring border:1.5px solid #CFC8BD.
    const ui = await mount(Screen, 'loading', size);
    const nodes = hosts(ui.root as unknown as Host).map(flat);
    const lines = nodes.filter((st) => st.flexDirection === 'row' && num(st.borderBottomWidth) > 0 && st.paddingVertical === 14);
    expect(lines).toHaveLength(5);
    lines.forEach((st) => expect(furthest(st.borderColor, '#ECE7DF')).toBeLessThanOrEqual(3));
    const rings = nodes.filter((st) => st.width === 28 && st.height === 28 && st.borderWidth === 1.5);
    expect(rings).toHaveLength(5);
    rings.forEach((st) => expect(furthest(st.borderColor, '#CFC8BD')).toBeLessThanOrEqual(4));
  });
});

it.each(EACH)('D4: the warm notice is the drawn #F2EEE6 on every kitchen screen (%s)', async (_s, size) => {
  // shopping-error / prep-error: .notice{background:#F2EEE6;border-left:3px solid #B08D57;...}
  for (const Screen of [GroceryListScreen, ShoppingListScreen, PrepGuideScreen, RecipesScreen, RecipeDetailScreen]) {
    const ui = await mount(Screen, 'error', size);
    expect(furthest(flat(ui.getAllByRole('alert')[0] as unknown as Host).backgroundColor, '#F2EEE6')).toBeLessThanOrEqual(1);
    ui.unmount();
  }
});

it('D7: the Add all sheet dims the whole page, its rounded top included, in the drawn ink', async () => {
  // prep-added: .dim{position:absolute;inset:0;background:rgba(26,26,24,.42)} under .sheet{border-radius:24px 24px 0 0}.
  const ui = await render(<StyleCSheet visible icon="cart-outline" title="Added to Grocery List" body="3 ingredients added to your grocery list." action="View List" link="OK" onAction={jest.fn()} onClose={jest.fn()} />);
  const scrim = flat(ui.getByTestId('stylec-scrim') as unknown as Host);
  expect(scrim.backgroundColor).toBe('rgba(26, 26, 24, 0.42)');
  expect(scrim.marginBottom).toBe(-24);
});

it.each(EACH)('D8: the recipe page\'s error block leaves 16 pt between notice and Try again (%s)', async (_s, size) => {
  // shopping-error: <div class="btn" style="margin-top:16px">Try again</div> under the notice.
  const ui = await mount(RecipeDetailScreen, 'error', size);
  expect(flat(hostParent(ui.getAllByRole('alert')[0] as unknown as Host)).gap).toBe(16);
});

it.each(EACH)('D9: the empty Grocery list draws the shopping bag (%s)', async (_s, size) => {
  // shopping-empty: the tile's line drawing is a bag (path "M13 21h30l-2 24H15z" with a handle), not a cart.
  const ui = await mount(GroceryListScreen, 'empty', size);
  expect(ui.getByTestId('icon-bag-outline')).toBeTruthy();
});

it.each(EACH)('D10: the prep-day chips draw the plain calendar (%s)', async (_s, size) => {
  // prep-plan .chipF svg: <rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>: no dots.
  const ui = await mount(PrepGuideScreen, 'loaded', size);
  await waitFor(() => expect(ui.getByText('Sunday')).toBeTruthy());
  expect(ui.getByTestId('icon-calendar-clear-outline')).toBeTruthy();
  expect(ui.queryByTestId('icon-calendar-outline')).toBeNull();
});

it.each(EACH)('D11: the method numerals are gold, at 4.5:1 or better on the paper (%s)', async (_s, size) => {
  // C_recipe (ios390, 100%): the step numerals are drawn in gold on the paper; gold 700 keeps body-text contrast.
  const ui = await mount(RecipeDetailScreen, 'loaded', size);
  const colour = flat(await waitFor(() => ui.getByText('1') as unknown as Host)).color as string;
  expect(colour).toBe(gold[700]);
  expect(contrast(colour, '#F7FAF7')).toBeGreaterThanOrEqual(4.5);
});

it.each(EACH)('D12: a Recipes row follows the drawn kitchen row (%s)', async (_s, size) => {
  // prep-plan: .rrow{display:flex;align-items:flex-start;gap:16px;padding:14px 0;...} .tile 64 (52 at 130%, .big .rrow .tile)
  // .rname{font-size:21px;line-height:1.25} .meta2{font-size:13px;line-height:1.45}
  const ui = await mount(RecipesScreen, 'loaded', size);
  const row = await waitFor(() => ui.getByRole('button', { name: 'Open Lentil soup' }) as unknown as Host);
  const tile = flat(ui.getByTestId('stylec-thumb', { includeHiddenElements: true }) as unknown as Host);
  expect(tile.width).toBe(size.fontScale > 1.15 ? 52 : 64);
  const inside = hosts(row).map(flat);
  expect(inside.filter((st) => st.paddingTop === 14 || st.paddingVertical === 14).length).toBeGreaterThanOrEqual(2);
  expect(inside.some((st) => st.paddingVertical === 20 || st.paddingTop === 20)).toBe(false);
  expect(flat(ui.getByText('Lentil soup') as unknown as Host)).toMatchObject({ fontSize: 21, lineHeight: 26.25 });
  expect(flat(ui.getByText(/^Declared free of/) as unknown as Host)).toMatchObject({ fontSize: 13, lineHeight: 18.85 });
});

it.each(EACH)('D13: Recipes loads with the row\'s own shape, as Prep does (%s)', async (_s, size) => {
  // prep-loading: each .lines .l row draws the 64 pt tile placeholder before its two bars.
  const ui = await mount(RecipesScreen, 'loading', size);
  const tiles = hosts(ui.root as unknown as Host).map(flat).filter((st) => st.width === 64 && st.height === 64 && st.borderRadius === 14);
  expect(tiles.length).toBeGreaterThanOrEqual(4);
});

it.each(EACH)('D14: the ingredient leader is the drawn #B9B2A7 dotted line (%s)', async (_s, size) => {
  // prep-plan: .ing .dots{flex:1;border-bottom:1.5px dotted #B9B2A7;...}
  const ui = await mount(PrepGuideScreen, 'loaded', size);
  await waitFor(() => expect(ui.getByText('Red lentils')).toBeTruthy());
  const leaders = hosts(ui.root as unknown as Host).map(flat).filter((st) => st.borderStyle === 'dotted');
  expect(leaders).toHaveLength(1);
  expect(furthest(leaders[0].borderColor, '#B9B2A7')).toBeLessThanOrEqual(2);
});
