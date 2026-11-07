// KITCHEN-REFINE-M: exact ctx#457 CSS values, not new features or copy.
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi, prepGuideApi } from '../../../services/api';
import { lightTokens } from '../../../theme/tokens';
import {
  StyleCEmpty, StyleCLoadingLines, StyleCMasthead, StyleCMastText, StyleCNotice, StyleCSheet, StyleCThumb,
} from '../../../ui/layout/StyleCPage';
import GroceryListScreen, { makeListStyles } from '../GroceryListScreen';
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

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) ?? {}) as Record<string, unknown>;
type Node = { props: { style?: unknown }; children?: (Node | string)[] | null };
const stylesOf = (node: Node | Node[] | string | null): Record<string, unknown>[] => {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(stylesOf);
  return [flat(node.props.style), ...(node.children ?? []).flatMap(stylesOf)];
};
const item = { id: 'one', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false };
const guide = {
  week_start: '2026-11-02', source: 'plan', week_filter_applied: true, prep_day_suggestions: ['Sunday', 'Wednesday'],
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
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); jest.restoreAllMocks(); });

it('M01: the kitchen masthead matches the drawn 4pt top and 2pt back-row gap without changing Screen', async () => {
  const ui = await render(<StyleCMasthead title="Prep guide" onBack={jest.fn()} />);
  const styles = stylesOf(ui.toJSON() as Node);
  expect(styles).toContainEqual(expect.objectContaining({ marginTop: -8, paddingHorizontal: 24, paddingBottom: 40 }));
  expect(styles).toContainEqual(expect.objectContaining({ marginBottom: 2, marginHorizontal: -10 }));
});

it.each([
  ['sub', { fontSize: 16, lineHeight: 23.2, marginTop: 8, letterSpacing: 0, fontVariant: ['tabular-nums'] }],
  ['muted', { fontSize: 14, lineHeight: 20.3, marginTop: 6 }],
  ['eyebrow', { fontSize: 11.5, lineHeight: 14, letterSpacing: 2, fontFamily: 'Inter_600SemiBold', fontWeight: '600' }],
] as const)('M02-M04: the %s masthead rule retains only its drawn numeric features', async (kind, expected) => {
  const ui = await render(<StyleCMastText kind={kind}>Words on main</StyleCMastText>);
  const style = flat(ui.getByText('Words on main').props.style);
  expect(style).toMatchObject(expected);
  if (kind !== 'sub') expect(style.fontVariant).toBeUndefined();
});

it('M13: the warm tile has the drawn 14pt corner and keeps its existing token', async () => {
  const ui = await render(<StyleCThumb />);
  expect(flat(ui.getByTestId('stylec-thumb', { includeHiddenElements: true }).props.style)).toMatchObject({
    borderRadius: 14, width: 64, height: 64,
  });
});

it('M14: the empty-state title and subtitle use their exact drawn metrics', async () => {
  const ui = await render(<StyleCEmpty icon="bag-outline" title="No recipes yet" subtitle="Words on main" />);
  expect(flat(ui.getByText('No recipes yet').props.style)).toMatchObject({ fontSize: 27, lineHeight: 32.4, letterSpacing: 0, fontWeight: '400' });
  expect(flat(ui.getByText('Words on main').props.style)).toMatchObject({ fontSize: 15, lineHeight: 22.5 });
});

it('M15-M16: the added sheet uses its own drawn title, button and link, without a new action', async () => {
  const onAction = jest.fn(), onClose = jest.fn();
  const ui = await render(<StyleCSheet visible icon="cart-outline" title="Added to Grocery List" body="3 ingredients added to your grocery list." action="View List" onAction={onAction} link="OK" onClose={onClose} />);
  expect(flat(ui.getByText('Added to Grocery List').props.style)).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', fontSize: 27, lineHeight: 32.4, letterSpacing: 0 });
  expect(flat(ui.getByText('3 ingredients added to your grocery list.').props.style)).toMatchObject({ lineHeight: 23.2, letterSpacing: 0 });
  expect(flat(ui.getByRole('button', { name: 'View List' }).props.style).minHeight).toBeCloseTo(65.52);
  expect(flat(ui.getByRole('button', { name: 'View List' }).props.style).borderRadius).toBe(16);
  expect(flat(ui.getByText('View List').props.style)).toMatchObject({ fontSize: 17, fontWeight: '600', letterSpacing: 0 });
  expect(flat(ui.getByText('OK').props.style)).toMatchObject({ fontSize: 16, fontWeight: '500' });
  await fireEvent.press(ui.getByRole('button', { name: 'View List' }));
  await fireEvent.press(ui.getByRole('button', { name: 'OK' }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('M17: the warm notice uses the drawn padding and regular body, retaining the alert region', async () => {
  const ui = await render(<StyleCNotice title="Couldn't load prep guide">Pull down to try again.</StyleCNotice>);
  expect(flat(ui.getByRole('alert').props.style)).toMatchObject({ borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16 });
  expect(flat(ui.getByText("Couldn't load prep guide").props.style)).toMatchObject({ fontWeight: '600', lineHeight: 22.95 });
  expect(flat(ui.getByText('Pull down to try again.').props.style)).toMatchObject({ fontWeight: '400', lineHeight: 23.2 });
});

it('M18: lead-specific loading rows have drawn 45/88 percent bars, 14pt padding and 20pt second bar', async () => {
  const ui = await render(<StyleCLoadingLines lead="tile" />);
  const styles = stylesOf(ui.toJSON() as Node);
  expect(styles).toContainEqual(expect.objectContaining({ width: '45%', height: 12 }));
  expect(styles).toContainEqual(expect.objectContaining({ width: '88%', height: 20 }));
  expect(styles).toContainEqual(expect.objectContaining({ paddingVertical: 14 }));
});

it.each([['Grocery list', GroceryListScreen], ['Shopping list', ShoppingListScreen]] as const)(
  'M19-M20: %s scrolls the existing title and add row with its rows, keeping the disabled/enabled plus meaning',
  async (title, Screen) => {
    const ui = await mount(Screen);
    await waitFor(() => expect(ui.getByText('Milk')).toBeTruthy());
    const list = within(ui.getByTestId('list-scroll'));
    expect(list.getByRole('header', { name: title })).toBeTruthy();
    expect(list.getByPlaceholderText('Add item…')).toBeTruthy();
    expect(flat(list.getByPlaceholderText('Add item…').props.style).height).toBeCloseTo(62.4);
    expect(flat(list.getByPlaceholderText('Add item…').props.style).width).toBe('100%');
    expect(flat(list.getByPlaceholderText('Qty').props.style).width).toBeCloseTo(67.6);
    expect(flat(list.getByPlaceholderText('Unit').props.style).width).toBe(91);
    const add = list.getByRole('button', { name: 'Add item' });
    expect(add.props.accessibilityState?.disabled ?? add.props.disabled).toBe(true);
    expect(flat(add.props.style).opacity).toBe(0.42);
    await fireEvent.changeText(ui.getByPlaceholderText('Add item…'), 'Bread');
    expect(ui.getByPlaceholderText('Add item…').props.value).toBe('Bread');
    // TouchableOpacity's mocked native-driver opacity stays at its initial value.
    // The render harness checks the enabled computed opacity; Jest checks the state.
    expect(ui.getByRole('button', { name: 'Add item' }).props.accessibilityState?.disabled ?? ui.getByRole('button', { name: 'Add item' }).props.disabled).toBe(false);
  },
);

it('M21-M24: both lists share the drawn overline, scalable row, normal serif tracking, and amount feature', () => {
  const colors = {
    background: lightTokens.bgPrimary, surface: lightTokens.bgPrimary, primary: lightTokens.accent,
    textPrimary: lightTokens.textPrimary, textMuted: lightTokens.textMuted, textOnPrimary: lightTokens.textOnAccent,
    border: lightTokens.border, error: lightTokens.textMuted,
  };
  const styles = makeListStyles(colors, 1.3);
  expect(styles.addRow.marginBottom).toBe(0);
  expect(styles.sectionHeader).toMatchObject({ paddingTop: 26, paddingBottom: 0 });
  expect(styles.sectionHeaderText).toMatchObject({ fontSize: 11.5, lineHeight: 14, fontWeight: '600', letterSpacing: 2, fontVariant: ['tabular-nums'] });
  expect(styles.itemRow).toMatchObject({ minHeight: 83.2, paddingVertical: 0 });
  expect(styles.itemName).toMatchObject({ lineHeight: 26.25, letterSpacing: 0 });
  expect(styles.itemMeta).toMatchObject({ fontSize: 15, letterSpacing: 0, fontVariant: ['tabular-nums'] });
  expect(flat(styles.itemMeta).lineHeight).toBeUndefined();
  expect(styles.clearBtn).toMatchObject({ paddingVertical: 16 });
});

it.each([1, 1.3])('M25-M26: the wrapped form and check gutter follow the drawing at %sx text', (fontScale) => {
  const styles = makeListStyles({
    background: lightTokens.bgPrimary, surface: lightTokens.bgPrimary, primary: lightTokens.accent,
    textPrimary: lightTokens.textPrimary, textMuted: lightTokens.textMuted, textOnPrimary: lightTokens.textOnAccent,
    border: lightTokens.border, error: lightTokens.textMuted,
  }, fontScale);
  expect(styles.addInputs).toMatchObject({ columnGap: 14, rowGap: 14, alignItems: 'flex-end' });
  expect(styles.nameInput.paddingTop).toBeCloseTo((48 - 18 * 1.21) * fontScale - 10);
  expect(styles.qtyInput.paddingTop).toBeCloseTo((48 - 16 * 1.21) * fontScale - 10);
  expect(styles.unitInput.paddingTop).toBeCloseTo((48 - 16 * 1.21) * fontScale - 10);
  expect(styles.qtyInput.paddingHorizontal).toBe(0);
  expect(styles.unitInput.paddingHorizontal).toBe(0);
  expect(styles.checkbox).toMatchObject({ width: 44, height: 44, marginLeft: -2, alignItems: 'flex-start' });
});

it('M05-M12: prep uses the drawn paper, overline, names, metadata, ingredients and large-text Add all height', async () => {
  const ui = await mount(PrepGuideScreen);
  await waitFor(() => expect(ui.getByText('Lentil soup')).toBeTruthy());
  const styles = stylesOf(ui.toJSON() as Node);
  expect(styles).toContainEqual(expect.objectContaining({ paddingHorizontal: 24, paddingTop: 22, paddingBottom: 24 }));
  expect(flat(ui.getByText('Recipes to prep (1)').props.style)).toMatchObject({ fontSize: 11.5, fontWeight: '600', letterSpacing: 2, fontVariant: ['tabular-nums'] });
  expect(flat(ui.getByText('Lentil soup').props.style)).toMatchObject({ lineHeight: 26.25, letterSpacing: 0 });
  expect(flat(ui.getByText(/30 min · 2 servings/).props.style)).toMatchObject({ lineHeight: 20.3, fontVariant: ['tabular-nums'] });
  expect(flat(ui.getByText('Declared free of 9 common allergens').props.style)).toMatchObject({ marginTop: 1, lineHeight: 18.85 });
  expect(flat(ui.getByText('Red lentils').props.style)).toMatchObject({ lineHeight: 22.4, letterSpacing: 0 });
  expect(flat(ui.getByText('400 g').props.style)).toMatchObject({ letterSpacing: 0, fontVariant: ['tabular-nums'] });
  expect(flat(ui.getByRole('button', { name: 'Add all ingredients' }).props.style).minHeight).toBeCloseTo(65.52);
  expect(flat(ui.getByText('Add all').props.style).letterSpacing).toBe(0);
  expect(flat(ui.getByText('This week').props.style).letterSpacing).toBe(0.3);
});
