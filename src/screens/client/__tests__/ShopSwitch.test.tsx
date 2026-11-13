/**
 * SHOP-SWITCH-M (owner 203-D16 op 1, ctx#527 style 1, the Masthead switch): two tabs, Grocery and Shopping, each with
 * its to-get count, under the title; the page shows the chosen list; add, tick, remove and Clear checked act on it.
 * One read (operator R1), no memory (R2), the switch only once the read has answered (R3).
 * The real GroceryListScreen is mounted at 390 pt with 100% text and at 320 x 568 with 130% text. The rows are the
 * mockup's fictional sample (planning/SHOP-SWITCH-MOCK/index.md:97); a small in-memory server keeps them, so a tick,
 * remove, add or clear shows on the next read as it would on the phone.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { Alert, Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { listsApi } from '../../../services/api';
import { colors as palette, darkTokens, gold, lightTokens, withAlpha } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { StyleCDashes } from '../../../ui/layout/StyleCPage';
import GroceryListScreen from '../GroceryListScreen';

let mockTokens = lightTokens;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: mockTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
// Each glyph is a plain view named for its icon, so a test can find the check on the chosen tab.
jest.mock('@expo/vector-icons', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { Ionicons: ({ name, size, color }: { name: string; size: number; color: string }) =>
    createElement(View, { testID: `icon-${name}`, style: { width: size, height: size }, iconColor: color }) };
});
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
}));

type Type = 'grocery' | 'shopping';
type Row = { id: string; name: string; quantity: number; unit?: string; is_checked: boolean };
// index.md:97: Grocery holds six rows (two checked; Paper towels is a non-food row typed after 10-07), Shopping three (one checked).
const GROCERY: Row[] = [
  { id: 'g1', name: 'Salmon fillet', quantity: 320, unit: 'g', is_checked: false },
  { id: 'g2', name: 'Baby potatoes', quantity: 400, unit: 'g', is_checked: false },
  { id: 'g3', name: 'Green beans', quantity: 240, unit: 'g', is_checked: true },
  { id: 'g4', name: 'Chicken breast', quantity: 300, unit: 'g', is_checked: false },
  { id: 'g5', name: 'Greek yoghurt', quantity: 1, unit: 'kg tub', is_checked: true },
  { id: 'g6', name: 'Paper towels', quantity: 2, unit: 'rolls', is_checked: false },
];
const SHOPPING: Row[] = [
  { id: 's1', name: 'Dish sponges', quantity: 1, unit: 'pack', is_checked: false },
  { id: 's2', name: 'Coffee filters', quantity: 1, unit: 'box', is_checked: true },
  { id: 's3', name: 'Laundry pods', quantity: 1, unit: 'bag', is_checked: false },
];
const groceryNames = GROCERY.map((row) => row.name);
const shoppingNames = SHOPPING.map((row) => row.name);
const NOTE = 'Includes items from your shopping list.';

// The in-memory server: each list's rows, or an Error for a failed read; `hold` keeps a read pending forever.
let store: Record<Type, Row[] | Error | 'hold'>;
let added = 0;
function serve(lists: Record<Type, Row[] | Error | 'hold'>) {
  store = {
    grocery: Array.isArray(lists.grocery) ? lists.grocery.map((row) => ({ ...row })) : lists.grocery,
    shopping: Array.isArray(lists.shopping) ? lists.shopping.map((row) => ({ ...row })) : lists.shopping,
  };
}
const rowsOf = (type: Type) => { const rows = store[type]; return Array.isArray(rows) ? rows : []; };
const ok = () => Promise.resolve({ data: {} } as never);
function installServer() {
  jest.mocked(listsApi.getList).mockImplementation((type: Type) => {
    const rows = store[type];
    if (rows === 'hold') return new Promise(() => undefined) as never;
    return (rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ data: rows.map((row) => ({ ...row })) })) as never;
  });
  jest.mocked(listsApi.addItem).mockImplementation((type: Type, body: { name: string; quantity?: number; unit?: string }) => {
    rowsOf(type).unshift({ id: `new-${(added += 1)}`, name: body.name, quantity: body.quantity ?? 1, unit: body.unit, is_checked: false });
    return ok();
  });
  jest.mocked(listsApi.updateItem).mockImplementation((id: string, patch: { is_checked?: boolean }) => {
    for (const type of ['grocery', 'shopping'] as const) rowsOf(type).forEach((row) => { if (row.id === id) Object.assign(row, patch); });
    return ok();
  });
  jest.mocked(listsApi.deleteItem).mockImplementation((id: string) => {
    for (const type of ['grocery', 'shopping'] as const) {
      const rows = rowsOf(type);
      const at = rows.findIndex((row) => row.id === id);
      if (at >= 0) rows.splice(at, 1);
    }
    return ok();
  });
  jest.mocked(listsApi.clearChecked).mockImplementation((type: Type) => {
    const rows = rowsOf(type);
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].is_checked) rows.splice(i, 1);
    return ok();
  });
}
const readsOf = (type: Type) => jest.mocked(listsApi.getList).mock.calls.filter(([t]) => t === type).length;
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<never>((res, rej) => { resolve = () => res({ data: {} } as never); reject = rej; });
  return { promise, resolve, reject };
}

const SIZES = [
  { size: '390/100', width: 390, height: 844, fontScale: 1 },
  { size: '320/130', width: 320, height: 568, fontScale: 1.3 },
] as const;
type Size = (typeof SIZES)[number];
const clients: QueryClient[] = [];
const newClient = (gcTime = 0) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return client;
};
async function mount(size: Size = SIZES[0], client = newClient()) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: size.width, height: size.height, scale: 1, fontScale: size.fontScale });
  return render(<QueryClientProvider client={client}><GroceryListScreen /></QueryClientProvider>);
}
type Ui = Awaited<ReturnType<typeof mount>>;
type Node = { type: unknown; props: Record<string, any>; children?: (Node | string)[] | null; parent?: Node | null };
const hostsIn = (node: Node | null | undefined): Node[] => (!node ? [] : [
  ...(typeof node.type === 'string' ? [node] : []),
  ...(node.children ?? []).flatMap((child) => (typeof child === 'string' ? [] : hostsIn(child))),
]);
const rootOf = (ui: Ui) => (ui as unknown as { container: Node }).container;
const tablists = (ui: Ui) => hostsIn(rootOf(ui)).filter((node) => node.props.accessibilityRole === 'tablist');
const tabLabels = (ui: Ui) => ui.queryAllByRole('tab').map((tab) => tab.props.accessibilityLabel);
const tab = (ui: Ui, name: string) => ui.getByRole('tab', { name });
const selected = (ui: Ui, name: string) => tab(ui, name).props.accessibilityState?.selected === true;
/** The masthead dashes (StyleCPage s.dash: 22 x 4), by their fill. */
const dashColors = (ui: { container: unknown }) => hostsIn(ui.container as Node)
  .map((node) => StyleSheet.flatten(node.props.style) ?? {})
  .filter((style) => style.width === 22 && style.height === 4)
  .map((style) => style.backgroundColor);
async function press(ui: Ui, name: string) { await fireEvent.press(tab(ui, name)); }
async function confirm(label: string) {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => buttons?.find((button) => button.text === label)?.onPress?.());
}
async function typeItem(ui: Ui, name: string, qty?: string, unit?: string) {
  await fireEvent.changeText(ui.getByPlaceholderText('Add item…'), name);
  if (qty != null) await fireEvent.changeText(ui.getByPlaceholderText('Qty'), qty);
  if (unit != null) await fireEvent.changeText(ui.getByPlaceholderText('Unit'), unit);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTokens = lightTokens;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  serve({ grocery: GROCERY, shopping: SHOPPING });
  installServer();
});
afterEach(() => {
  onlineManager.setOnline(true);
  clients.splice(0).forEach((client) => client.clear());
  jest.restoreAllMocks();
});

describe.each(SIZES)('SHOP-SWITCH-M on the grocery list at $size', (size) => {
  it('a. opens on Grocery: its title, two tabs with their to-get counts, only grocery rows, no mixed-list note', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    expect(ui.getByRole('header', { name: 'Grocery list' })).toBeTruthy();
    expect(tablists(ui)).toHaveLength(1);
    expect(tabLabels(ui)).toEqual(['Grocery, 4 to get', 'Shopping, 2 to get']);
    expect(selected(ui, 'Grocery, 4 to get')).toBe(true);
    expect(selected(ui, 'Shopping, 2 to get')).toBe(false);
    for (const name of groceryNames) expect(ui.getAllByText(name)).toHaveLength(1);
    for (const name of shoppingNames) expect(ui.queryByText(name)).toBeNull();
    expect(ui.getByText('4 to get.')).toBeTruthy();
    expect(ui.getByText('To get (4)')).toBeTruthy();
    expect(ui.getByText('Checked (2)')).toBeTruthy();
    expect(ui.queryByText(NOTE)).toBeNull();
  });

  it('b. a tap on Shopping shows the shopping list with one selection tick; a second tap changes nothing', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    const tick = jest.spyOn(HapticService, 'selection');
    await press(ui, 'Shopping, 2 to get');
    expect(ui.getByRole('header', { name: 'Shopping list' })).toBeTruthy();
    expect(ui.queryByRole('header', { name: 'Grocery list' })).toBeNull();
    for (const name of shoppingNames) expect(ui.getAllByText(name)).toHaveLength(1);
    for (const name of groceryNames) expect(ui.queryByText(name)).toBeNull();
    expect(ui.getByText('2 to get.')).toBeTruthy();
    expect(tick).toHaveBeenCalledTimes(1);
    expect(selected(ui, 'Shopping, 2 to get')).toBe(true);
    expect(selected(ui, 'Grocery, 4 to get')).toBe(false);
    await press(ui, 'Shopping, 2 to get');
    expect(tick).toHaveBeenCalledTimes(1);
    expect(selected(ui, 'Shopping, 2 to get')).toBe(true);
    expect(ui.getByRole('header', { name: 'Shopping list' })).toBeTruthy();
  });

  it('c. an add goes to the list chosen at the tap: Shopping, then Grocery', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    await press(ui, 'Shopping, 2 to get');
    await typeItem(ui, 'Bin bags', '1', 'roll');
    await fireEvent.press(ui.getByLabelText('Add item'));
    await waitFor(() => expect(listsApi.addItem).toHaveBeenCalledWith('shopping', { name: 'Bin bags', quantity: 1, unit: 'roll' }));
    expect(listsApi.addItem).not.toHaveBeenCalledWith('grocery', expect.anything());
    await ui.findByText('Bin bags');
    await waitFor(() => expect(tabLabels(ui)).toEqual(['Grocery, 4 to get', 'Shopping, 3 to get']));
    await press(ui, 'Grocery, 4 to get');
    expect(ui.queryByText('Bin bags')).toBeNull();
    await typeItem(ui, 'Rice');
    await fireEvent.press(ui.getByLabelText('Add item'));
    await waitFor(() => expect(listsApi.addItem).toHaveBeenCalledWith('grocery', { name: 'Rice', quantity: 1, unit: undefined }));
    expect(jest.mocked(listsApi.addItem).mock.calls.map(([type]) => type)).toEqual(['shopping', 'grocery']);
    await ui.findByText('Rice');
  });

  it('c. an add made on Shopping still goes to Shopping when the client switches to Grocery before it is sent', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    await press(ui, 'Shopping, 2 to get');
    await typeItem(ui, 'Bin bags');
    act(() => onlineManager.setOnline(false));
    await fireEvent.press(ui.getByLabelText('Add item'));
    expect(listsApi.addItem).not.toHaveBeenCalled();
    await press(ui, 'Grocery, 4 to get');
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(listsApi.addItem).toHaveBeenCalledTimes(1));
    expect(listsApi.addItem).toHaveBeenCalledWith('shopping', { name: 'Bin bags', quantity: 1, unit: undefined });
    expect(listsApi.addItem).not.toHaveBeenCalledWith('grocery', expect.anything());
  });

  it('d. Clear checked on Grocery counts and clears the grocery list only; the shopping rows stay', async () => {
    const ui = await mount(size);
    await ui.findByText('Green beans');
    await fireEvent.press(ui.getByText('Clear checked'));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toBe('Remove 2 checked items?');
    await confirm('Clear');
    await waitFor(() => expect(listsApi.clearChecked).toHaveBeenCalledWith('grocery'));
    expect(listsApi.clearChecked).toHaveBeenCalledTimes(1);
    expect(listsApi.clearChecked).not.toHaveBeenCalledWith('shopping');
    await waitFor(() => expect(ui.queryByText('Green beans')).toBeNull());
    await press(ui, 'Shopping, 2 to get');
    for (const name of shoppingNames) expect(ui.getByText(name)).toBeTruthy();
    expect(ui.getByLabelText('Uncheck Coffee filters')).toBeTruthy();
  });

  it('d. Clear checked on Shopping counts and clears the shopping list only; the grocery rows stay', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    await press(ui, 'Shopping, 2 to get');
    await fireEvent.press(ui.getByText('Clear checked'));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[1]).toBe('Remove 1 checked item?');
    await confirm('Clear');
    await waitFor(() => expect(listsApi.clearChecked).toHaveBeenCalledWith('shopping'));
    expect(listsApi.clearChecked).toHaveBeenCalledTimes(1);
    expect(listsApi.clearChecked).not.toHaveBeenCalledWith('grocery');
    await waitFor(() => expect(ui.queryByText('Coffee filters')).toBeNull());
    await press(ui, 'Grocery, 4 to get');
    for (const name of groceryNames) expect(ui.getByText(name)).toBeTruthy();
    expect(ui.getByLabelText('Uncheck Green beans')).toBeTruthy();
  });

  it('e. a tick and a remove on Shopping send the shopping row and move only the Shopping count', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    await press(ui, 'Shopping, 2 to get');
    await fireEvent.press(ui.getByLabelText('Check Dish sponges'));
    await waitFor(() => expect(listsApi.updateItem).toHaveBeenCalledWith('s1', { is_checked: true }));
    await waitFor(() => expect(tabLabels(ui)).toEqual(['Grocery, 4 to get', 'Shopping, 1 to get']));
    await fireEvent.press(ui.getByLabelText('Remove Laundry pods'));
    await waitFor(() => expect(listsApi.deleteItem).toHaveBeenCalledWith('s3'));
    await waitFor(() => expect(tabLabels(ui)).toEqual(['Grocery, 4 to get', 'Shopping, 0 to get']));
    expect(ui.getByText('All items checked.')).toBeTruthy();
    expect(ui.queryByText('Laundry pods')).toBeNull();
  });

  it('f. an empty Grocery list shows its own empty words beside the Shopping count, with no dashes or summary', async () => {
    serve({ grocery: [], shopping: SHOPPING });
    const ui = await mount(size);
    await ui.findByText('Your grocery list is empty');
    expect(ui.getByText('Add items using the field above.')).toBeTruthy();
    expect(tabLabels(ui)).toEqual(['Grocery, 0 to get', 'Shopping, 2 to get']);
    expect(dashColors(ui as never)).toHaveLength(0);
    expect(ui.queryByText(/to get\.$|^All items checked\.$/)).toBeNull();
    for (const name of shoppingNames) expect(ui.queryByText(name)).toBeNull();
    await press(ui, 'Shopping, 2 to get');
    for (const name of shoppingNames) expect(ui.getByText(name)).toBeTruthy();
    expect(ui.queryByText('Your grocery list is empty')).toBeNull();
    expect(ui.getByText('2 to get.')).toBeTruthy();
    expect(dashColors(ui as never)).toHaveLength(3);
  });

  it('f. both lists empty: the switch still shows, with the grocery empty words', async () => {
    serve({ grocery: [], shopping: [] });
    const ui = await mount(size);
    await ui.findByText('Your grocery list is empty');
    expect(tablists(ui)).toHaveLength(1);
    expect(tabLabels(ui)).toEqual(['Grocery, 0 to get', 'Shopping, 0 to get']);
    expect(dashColors(ui as never)).toHaveLength(0);
  });

  it('f. an empty Shopping list, when chosen, says so in its own words', async () => {
    serve({ grocery: GROCERY, shopping: [] });
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    await press(ui, 'Shopping, 0 to get');
    expect(ui.getByText('Your shopping list is empty')).toBeTruthy();
    expect(ui.getByText('Add items using the field above.')).toBeTruthy();
    expect(ui.getByRole('header', { name: 'Shopping list' })).toBeTruthy();
    expect(ui.queryByText('Your grocery list is empty')).toBeNull();
    expect(ui.queryByText(/to get\.$|^All items checked\.$/)).toBeNull();
    expect(dashColors(ui as never)).toHaveLength(0);
    expect(ui.queryByText('Clear checked')).toBeNull();
  });

  it('g. every grocery row ticked: "All items checked." and a Grocery count of 0', async () => {
    serve({ grocery: GROCERY.map((row) => ({ ...row, is_checked: true })), shopping: SHOPPING });
    const ui = await mount(size);
    await ui.findByText('All items checked.');
    expect(tabLabels(ui)).toEqual(['Grocery, 0 to get', 'Shopping, 2 to get']);
    expect(dashColors(ui as never)).toHaveLength(6);
  });

  it('i. no switch while the lists load: main\'s loading words under the Grocery title', async () => {
    serve({ grocery: 'hold', shopping: SHOPPING });
    const ui = await mount(size);
    expect(ui.getByText('Loading grocery list…')).toBeTruthy();
    expect(ui.getByRole('header', { name: 'Grocery list' })).toBeTruthy();
    expect(tablists(ui)).toHaveLength(0);
    expect(ui.queryAllByRole('tab')).toHaveLength(0);
  });

  it('i. a failed read shows main\'s block with no switch; Try again reads both lists and brings the switch', async () => {
    serve({ grocery: GROCERY, shopping: new Error('offline') });
    const ui = await mount(size);
    await ui.findByText("Couldn't load grocery list.");
    expect(ui.getByText('Try again')).toBeTruthy();
    expect(tablists(ui)).toHaveLength(0);
    expect(ui.queryAllByRole('tab')).toHaveLength(0);
    serve({ grocery: GROCERY, shopping: SHOPPING });
    await fireEvent.press(ui.getByText('Try again'));
    await ui.findByText('Salmon fillet');
    expect(readsOf('grocery')).toBe(2);
    expect(readsOf('shopping')).toBe(2);
    expect(tabLabels(ui)).toEqual(['Grocery, 4 to get', 'Shopping, 2 to get']);
  });

  it('j. no memory: closed on Shopping, the screen opens again on Grocery', async () => {
    const client = newClient(Infinity);
    const first = await mount(size, client);
    await first.findByText('Salmon fillet');
    await press(first, 'Shopping, 2 to get');
    await first.findByText('Dish sponges');
    await first.unmount();
    const again = await mount(size, client);
    await again.findByText('Salmon fillet');
    expect(selected(again, 'Grocery, 4 to get')).toBe(true);
    expect(again.getByRole('header', { name: 'Grocery list' })).toBeTruthy();
    expect(again.queryByText('Dish sponges')).toBeNull();
  });

  it('m. Prep guide\'s Add all reaches this screen: its invalidate brings the new rows onto the Grocery tab', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    rowsOf('grocery').unshift({ id: 'p1', name: 'Red lentils', quantity: 400, unit: 'g', is_checked: false });
    await act(async () => { await clients[0].invalidateQueries({ queryKey: ['lists', 'grocery'] }); });
    await ui.findByText('Red lentils');
    expect(tabLabels(ui)).toEqual(['Grocery, 5 to get', 'Shopping, 2 to get']);
    const prep = fs.readFileSync(path.join(__dirname, '..', 'PrepGuideScreen.tsx'), 'utf8');
    expect(prep).toContain("invalidateQueries({ queryKey: ['lists', 'grocery'] })");
    expect(prep).toContain("navigation.navigate('GroceryList')");
  });

  it('o. a tick made on Shopping and undone by a failed save comes back on the shopping row after a switch', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    await press(ui, 'Shopping, 2 to get');
    const save = deferred();
    jest.mocked(listsApi.updateItem).mockImplementationOnce(() => save.promise);
    await fireEvent.press(ui.getByLabelText('Check Dish sponges'));
    await waitFor(() => expect(tabLabels(ui)).toEqual(['Grocery, 4 to get', 'Shopping, 1 to get']));
    await press(ui, 'Grocery, 4 to get');
    await act(async () => save.reject(new Error('offline')));
    await waitFor(() => expect(tabLabels(ui)).toEqual(['Grocery, 4 to get', 'Shopping, 2 to get']));
    expect(listsApi.updateItem).toHaveBeenCalledWith('s1', { is_checked: true });
    await press(ui, 'Shopping, 2 to get');
    expect(ui.getByLabelText('Check Dish sponges')).toBeTruthy();
  });

  it('o. a Clear checked made on Shopping clears Shopping even when it lands after a switch to Grocery', async () => {
    const ui = await mount(size);
    await ui.findByText('Salmon fillet');
    await press(ui, 'Shopping, 2 to get');
    const clear = deferred();
    jest.mocked(listsApi.clearChecked).mockImplementationOnce((type: Type) => {
      return clear.promise.finally(() => { store[type] = rowsOf(type).filter((row) => !row.is_checked); }) as never;
    });
    await fireEvent.press(ui.getByText('Clear checked'));
    await confirm('Clear');
    await press(ui, 'Grocery, 4 to get');
    await act(async () => clear.resolve());
    await waitFor(() => expect(listsApi.clearChecked).toHaveBeenCalledTimes(1));
    expect(listsApi.clearChecked).toHaveBeenCalledWith('shopping');
    expect(ui.getByLabelText('Uncheck Green beans')).toBeTruthy();
    expect(ui.getByText('Clear checked')).toBeTruthy();
  });
});

describe('SHOP-SWITCH-M: the switch itself', () => {
  it('h. the masthead dashes are bone: filled ones textOnAccent, the rest textOnAccent at 0.22, none gold', async () => {
    const ui = await render(<StyleCDashes total={6} done={2} label="4 to get." />);
    const on = lightTokens.textOnAccent;
    const off = withAlpha(lightTokens.textOnAccent, 0.22);
    const fills = dashColors(ui as never);
    expect(fills).toEqual([on, on, off, off, off, off]);
    expect(fills).not.toContain(gold[300]);
  });

  it('k. at 320 x 568 and 130%: 44 pt tabs whose words wrap and are never shrunk; the chosen one has a check and weight', async () => {
    const ui = await mount(SIZES[1]);
    await ui.findByText('Salmon fillet');
    const [grocery, shopping] = ui.getAllByRole('tab');
    for (const one of [grocery, shopping]) {
      const style = StyleSheet.flatten(one.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
      expect(style.flexWrap).toBe('wrap');
      const words = hostsIn(one as unknown as Node).filter((node) => node.type === 'Text');
      expect(words.length).toBeGreaterThanOrEqual(2);
      for (const text of words) {
        expect(text.props.numberOfLines).toBeUndefined();
        expect(text.props.adjustsFontSizeToFit).toBeUndefined();
        expect(text.props.allowFontScaling).not.toBe(false);
        expect(text.props.maxFontSizeMultiplier).toBe(1.3);
      }
    }
    expect(ui.getByRole('header', { name: 'Grocery list' }).props.maxFontSizeMultiplier).toBe(1.2);
    expect(within(grocery).getByText('Grocery')).toBeTruthy();
    expect(within(grocery).getByText('4')).toBeTruthy();
    expect(within(shopping).getByText('Shopping')).toBeTruthy();
    expect(within(shopping).getByText('2')).toBeTruthy();
    // More than colour (index.md:80): the chosen tab has the check glyph, hidden from screen readers, and weight 600.
    const check = within(grocery).getByTestId('icon-checkmark') as unknown as Node;
    let hidden = false;
    for (let node: Node | null | undefined = check; node && node !== (grocery as unknown as Node); node = node.parent) {
      if (node.props.accessibilityElementsHidden === true && node.props.importantForAccessibility === 'no-hide-descendants') hidden = true;
    }
    expect(hidden).toBe(true);
    expect(within(shopping).queryByTestId('icon-checkmark')).toBeNull();
    const weight = (node: unknown) => StyleSheet.flatten((node as Node).props.style);
    expect(weight(within(grocery).getByText('Grocery'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontWeight: '600' });
    expect(weight(within(shopping).getByText('Shopping')).fontFamily).toBe('Inter_400Regular');
  });

  it('n. the switch is drawn in tokens: bone fill and ink on the chosen tab, the forest-band line round it, in light and dark', async () => {
    for (const tokens of [lightTokens, darkTokens]) {
      mockTokens = tokens;
      const ui = await mount();
      await ui.findByText('Salmon fillet');
      const [list] = tablists(ui);
      expect(StyleSheet.flatten(list.props.style)).toMatchObject({ borderColor: tokens.surface.forestBandLine, borderWidth: 1 });
      const [grocery, shopping] = ui.getAllByRole('tab');
      expect(StyleSheet.flatten(grocery.props.style).backgroundColor).toBe(tokens.textOnAccent);
      expect(StyleSheet.flatten(shopping.props.style).backgroundColor).toBeUndefined();
      // The chosen tab's ink stays the drawing's ink (#1A1A18) in dark mode too: the bone fill does not change there.
      expect(StyleSheet.flatten(within(grocery).getByText('Grocery').props.style).color).toBe(palette.ink);
      expect(StyleSheet.flatten(within(shopping).getByText('Shopping').props.style).color).toBe(withAlpha(tokens.textOnAccent, 0.86));
      await ui.unmount();
    }
  });

  it('l. no colour literal in the screen\'s code (tokens only)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'GroceryListScreen.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^(.*?)\/\/.*$/gm, (line, before: string) =>
      (/['"`]/.test(before) ? line : before));
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\brgba?\(/);
  });
});
