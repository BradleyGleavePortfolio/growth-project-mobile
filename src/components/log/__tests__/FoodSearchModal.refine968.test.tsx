/**
 * REFINE-968 (owner #203-E49, fix round 1 on m#968): the food Add sheet rebuilt from the C2 Style C add sheet
 * (context a9434a53 planning/MOCKUP3/C2/style-c/C_add_*; markup handoffs/op-144/ops144/shots/MOCK-C2/html/C_add.html,
 * whose CSS line each case quotes). Operator rulings 23:5x PST 11-12: the sheet over the day (2), "Add at {time}" only
 * when a save now files under today (3), the drawn three-column tool row with main's one tile (4; it reads the drawn
 * "Quick add" with the drawn bolt, QUICKADD-968), Frequent kept (5), the bowl on rows with no photo (6), the sheet
 * fill sc.bgSurface (9). No tile, tab or control for a feature phone main lacks: no Photo of a meal, Scan a barcode,
 * Favourites or Saved meals in any state.
 */
import React from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import FoodSearchModal from '../FoodSearchModal';
import { colors as palette, gold, lightTokens, radius } from '../../../theme/tokens';
import type { SearchResult } from '../../../utils/log/types';
import type { MealType } from '../../../types';
import { getFoodImageUrl } from '../../../utils/foodImages';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../../../screens/client/LogScreen';
import { logApi } from '../../../services/api';
import { getTodayString } from '../../../utils/date';

jest.mock('@expo/vector-icons', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { Ionicons: (p: Record<string, unknown>) => R.createElement(View, { ...p, iconName: p.name }) };
});
jest.mock('../../../ui', () => ({ ...jest.requireActual('../../../ui'), useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// The drawn glyphs as plain host views carrying their svg props, so a case can read size, stroke and shape.
jest.mock('react-native-svg', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const part = (kind: string) => (p: Record<string, unknown>) => R.createElement(View, { ...p, svgKind: kind });
  return { __esModule: true, default: part('Svg'), Svg: part('Svg'), Path: part('Path'), Ellipse: part('Ellipse'), Circle: part('Circle') };
});

// The mounted case (LogScreen's own close guard, LogScreen.tsx:824-833): the Food tab's first day on today, as
// LogScreen.fix930r1-addSheet.test.tsx mounts it; the day is read from the faked clock at render.
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
const mockStore = {
  get selectedDate() { return getTodayString(); }, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, waterOz: 0,
  isLoading: false, loadError: null, setSelectedDate: jest.fn(),
  loadDayData: jest.fn().mockResolvedValue(undefined),
  refreshShownDay: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
jest.mock('../../../hooks/useFoodBrowse', () => ({
  useFoodBrowse: () => ({
    recentFoods: [{ id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5, serving_size_grams: 40,
      nutrient_basis: 'PER_100G', supports_volume_units: false }],
    frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn().mockResolvedValue(1), syncFoodLogQueue: jest.fn() }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async (url: string) => ({ data: url.startsWith('/assignments/me') ? { items: [], nextCursor: null } : { assignments: [] } }) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn().mockResolvedValue({ data: { entries: [] } }) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn().mockResolvedValue(undefined), getQueueLength: jest.fn().mockResolvedValue(0) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

type Node = { type: string; props: Record<string, any>; children: Array<Node | string>; parent: Node | null;
  queryAll: (match: (n: Node) => boolean) => Node[] };
const flat = (n: unknown) => (StyleSheet.flatten((n as Node).props.style) ?? {}) as Record<string, unknown>;
const svgsIn = (n: unknown, kind = 'Svg') => (n as Node).queryAll((x) => x.props.svgKind === kind);
const kids = (n: unknown) => (n as Node).children.filter((c): c is Node => typeof c === 'object');
const imageUris = (n: unknown) => (n as Node).queryAll((x) => x.type === 'Image').map((x) => x.props.source?.uri);

const flatWhite: SearchResult = { id: 'fw', name: 'Flat white', calories: 46, protein: 2.5, carbs: 3.7, fat: 2.4,
  nutrient_basis: 'PER_100G', last_quantity: 240, last_unit: 'ml', from_log: true };
const yoghurt: SearchResult = { id: 'gy', name: 'Greek yoghurt, plain', calories: 59, protein: 10, carbs: 3.6, fat: 0.4,
  nutrient_basis: 'PER_100G', last_quantity: 200, last_unit: 'g', from_log: true };
const banana: SearchResult = { id: 'bn', name: 'Banana', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, nutrient_basis: 'PER_100G' };
const offPick: SearchResult = { id: 'off_3017620422003', name: 'Oat drink', brand: 'Made-up Farm', calories: 45, protein: 1, carbs: 7,
  fat: 1.5, nutrient_basis: 'PER_100G', image_url: 'https://images.example.test/oat-drink.jpg' };

const handlers = {
  onClose: jest.fn(), onSearchChange: jest.fn(), onClearSearch: jest.fn(), onRetrySearch: jest.fn(), onRecentTabChange: jest.fn(),
  onSelectFood: jest.fn(), onEnterManualMode: jest.fn(), onExitManualMode: jest.fn(), onManualFieldChange: jest.fn(),
  onManualLog: jest.fn(), onRepeatMeal: jest.fn(), onMealChange: jest.fn(),
};
const base = {
  ...handlers, visible: true, activeMealType: 'snack' as MealType, searchQuery: '', searching: false, showSlowMessage: false,
  searchError: null, searchResults: [], didYouMean: [], recentTab: 'recent' as const, recentFoods: [flatWhite, yoghurt, banana, offPick],
  frequentFoods: [banana], manualMode: false,
  manualFields: { foodName: '', calories: '', protein: '', carbs: '', fat: '', quantity: '1', unit: 'serving' },
};
type Over = Partial<React.ComponentProps<typeof FoodSearchModal>>;
const { onMealChange: _choice, onRepeatMeal: _repeat, ...plain } = base;
const show = (over: Over = {}) => render(<FoodSearchModal {...plain} {...over} />);
const portion = <Text testID="portion-stub">Portion picker</Text>;
// The dim is not focusable, and the sheet beside it is announced as modal, so the reader skips it (as it should).
const dimOf = () => screen.getByTestId('food-search-dim', { includeHiddenElements: true });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 13, 15, 10, 0));
});
afterEach(() => jest.useRealTimers());

describe('the sheet over the day (ruling 2)', () => {
  it('is a transparent sheet over the day: .c-sheet :110 dim ink 0.36, .sheet :59 corners 24 and surface fill, markup height 90%', async () => {
    await show();
    const modal = screen.getByTestId('food-search-sheet');
    expect(modal.props).toMatchObject({ visible: true, transparent: true, statusBarTranslucent: true, animationType: 'slide' });
    expect(modal.props.presentationStyle).toBeUndefined();
    const dim = dimOf();
    expect(flat(dim).backgroundColor).toBe('rgba(26, 26, 24, 0.36)');
    expect(dim.props.accessible).toBe(false);
    expect(dim.props.importantForAccessibility).toBe('no');
    const frame = screen.getByTestId('food-search-frame');
    expect(flat(frame)).toMatchObject({
      height: Dimensions.get('window').height * 0.9, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
      backgroundColor: lightTokens.bgSurface, shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08,
    });
    expect(frame.props.accessibilityViewIsModal).toBe(true);
  });

  it('draws the drawn grab: .grab :60 36 x 5 in the border colour, 14 below', async () => {
    await show();
    const grip = screen.getByTestId('sheet-grip', { includeHiddenElements: true });
    expect(flat(grip)).toMatchObject({ width: 36, height: 5, backgroundColor: lightTokens.border });
    expect(flat(grip.parent as never)).toMatchObject({ paddingTop: 10, paddingBottom: 14 });
  });

  it('draws the portion picker in the same sheet, with no second grab of its own', async () => {
    await show({ portionPicker: portion });
    expect(within(screen.getByTestId('food-search-frame')).getByTestId('portion-stub')).toBeTruthy();
    expect(screen.queryAllByTestId('sheet-grip', { includeHiddenElements: true })).toHaveLength(0);
    expect(flat(screen.getByTestId('food-search-frame')).backgroundColor).toBe(lightTokens.bgSurface);
  });
});

describe('every close path calls onClose once, and nothing closes it while a food saves', () => {
  const drag = async (to: number) => {
    const zone = screen.getByTestId('food-search-drag');
    await fireEvent(zone, 'touchStart', { nativeEvent: { pageY: 100 } });
    await fireEvent(zone, 'responderMove', { nativeEvent: { pageY: to } });
    await fireEvent(zone, 'responderRelease', { nativeEvent: { pageY: to } });
  };
  it.each([
    ['the close (.tap :69)', async () => { await fireEvent.press(screen.getByRole('button', { name: 'Close food search' })); }, {}],
    ['Done after a food is added', async () => { await fireEvent.press(screen.getByRole('button', { name: 'Done' })); }, { addedFoodName: 'Banana' }],
    ['the system Back (onRequestClose)', async () => { await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose'); }, {}],
    ['a tap on the dim (.c-sheet :110)', async () => { await fireEvent.press(dimOf()); }, {}],
    ['a downward drag on the grab', async () => drag(220), {}],
    ['a downward drag over the portion picker', async () => drag(220), { portionPicker: portion }],
  ] as const)('%s', async (_name, act1, over) => {
    await show(over as Over);
    await act1();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('a short pull springs back and does not close', async () => {
    await show();
    await drag(130);
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it.each([['search', {}], ['portion', { portionPicker: portion }]] as const)('while saving (%s), the dim and the drag call nothing', async (_n, over) => {
    await show({ ...(over as Over), saving: true });
    await fireEvent.press(dimOf());
    await drag(260);
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});

describe('the title (ruling 3): "Add at {time}" over the meal only when a save now files under today', () => {
  const title = () => screen.getByTestId('food-search-title');
  const meal = () => screen.queryByTestId('food-search-meal');
  it('today at 3:10 pm: "Add at 3:10 pm" (.h2 :45, Cormorant 500 24/30) over "Snacks" (.meta :49, Inter 14/20 muted)', async () => {
    await show({ savesToday: () => true });
    expect(title()).toHaveTextContent('Add at 3:10 pm');
    expect(meal()).toHaveTextContent('Snacks');
    expect(flat(title())).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 24, lineHeight: 30, color: lightTokens.textPrimary });
    expect(flat(meal() as never)).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: lightTokens.textMuted });
    expect(screen.getByRole('header', { name: 'Add at 3:10 pm, Snacks' })).toBeTruthy();
  });

  it.each([[12, 0, 'Add at 12:00 pm'], [0, 5, 'Add at 12:05 am'], [23, 59, 'Add at 11:59 pm']])('%i:%i reads "%s"', async (h, m, words) => {
    jest.setSystemTime(new Date(2026, 9, 13, h, m, 0));
    await show({ savesToday: () => true, activeMealType: 'breakfast' });
    expect(title()).toHaveTextContent(words);
    expect(meal()).toHaveTextContent('Breakfast');
  });

  it('moves on each minute while open and reads the day rule again on each tick', async () => {
    const savesToday = jest.fn(() => true);
    await show({ savesToday });
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(title()).toHaveTextContent('Add at 3:11 pm');
    savesToday.mockReturnValue(false);
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    expect(title()).toHaveTextContent('Add to Snacks');
    expect(meal()).toBeNull();
  });

  it('stops its tick when the sheet closes', async () => {
    const savesToday = jest.fn(() => true);
    const view = await show({ savesToday });
    await view.rerender(<FoodSearchModal {...plain} savesToday={savesToday} visible={false} />);
    const calls = savesToday.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(5 * 60 * 1000); });
    expect(savesToday.mock.calls.length).toBe(calls);
  });

  it.each([['a past day', { savesToday: () => false }], ['no day rule given', {}]] as const)('%s keeps "Add to Snacks" in the drawn type, with no meal line', async (_n, over) => {
    await show(over as Over);
    expect(title()).toHaveTextContent('Add to Snacks');
    expect(flat(title())).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 24, lineHeight: 30 });
    expect(meal()).toBeNull();
    expect(screen.getByRole('header', { name: 'Add to Snacks' })).toBeTruthy();
  });

  it('the Extras Add: the meal row switching Lunch to Dinner updates the meal line', async () => {
    const view = await show({ savesToday: () => true, onMealChange: handlers.onMealChange, activeMealType: 'lunch' });
    expect(meal()).toHaveTextContent('Lunch');
    await fireEvent.press(within(screen.getByTestId('food-search-meals')).getByLabelText('Dinner'));
    expect(handlers.onMealChange).toHaveBeenCalledWith('dinner');
    await view.rerender(<FoodSearchModal {...plain} savesToday={() => true} onMealChange={handlers.onMealChange} activeMealType="dinner" />);
    expect(meal()).toHaveTextContent('Dinner');
    expect(title()).toHaveTextContent('Add at 3:10 pm');
  });
});

describe('the drawn parts (C_add.html)', () => {
  it('the close: .tap :69, a 44 pt box holding the drawn 22 pt cross at stroke 1.6', async () => {
    await show();
    const close = screen.getByRole('button', { name: 'Close food search' });
    expect(flat(close)).toMatchObject({ minWidth: 44, minHeight: 44 });
    const [glyph] = svgsIn(close);
    expect(glyph.props).toMatchObject({ width: 22, height: 22, strokeWidth: 1.6 });
  });

  it('the tools: .c-big2 :121 three equal columns, gap 8, 12 above and below, with main\'s one tile in the first', async () => {
    const dims = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    await show();
    dims.mockRestore();
    const grid = screen.getByTestId('food-tools');
    expect(flat(grid)).toMatchObject({ flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 });
    const cells = kids(grid);
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => flat(c).flex)).toEqual([1, 1, 1]);
    const tile = screen.getByRole('button', { name: 'Quick add, enter a food manually' });
    expect(tile.parent).toBe(cells[0]);
    // Columns 2 and 3 hold their place for MEAL-PHOTO-M and a later barcode tile: empty, nothing to press.
    expect(cells.slice(1).map((c) => c.children.length)).toEqual([0, 0]);
  });

  it('past 100% text the manual tile takes two shares, so its words stay inside the tile', async () => {
    expect(Dimensions.get('window').fontScale).toBeGreaterThan(1); // the jest window reads a larger text size
    await show();
    expect(kids(screen.getByTestId('food-tools')).map((c) => flat(c).flex)).toEqual([2, 1, 1]);
  });

  it('main\'s manual tile in the drawn shape: .c-big2 a :122 1 pt forest border, corner 16, 72 tall, glyph 24 above the label, Inter 500 15/19 forest', async () => {
    await show();
    const tile = screen.getByRole('button', { name: 'Quick add, enter a food manually' });
    expect(flat(tile)).toMatchObject({ borderWidth: 1, borderColor: lightTokens.accent, borderRadius: radius.card, minHeight: 72,
      gap: 6, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'flex-start', justifyContent: 'center' });
    const inside = kids(tile);
    expect(inside[0].props).toMatchObject({ svgKind: 'Svg', width: 24, height: 24, stroke: lightTokens.accentText, strokeWidth: 1.6 });
    expect(svgsIn(inside[0], 'Path').map((p) => p.props.d)).toEqual(['M13 3.5L6 13h5l-1 7.5 7-9.5h-5z']);
    expect(inside[1]).toHaveTextContent('Quick add');
    expect(flat(inside[1])).toMatchObject({ fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 19, color: lightTokens.accentText });
    await fireEvent.press(tile);
    expect(handlers.onEnterManualMode).toHaveBeenCalledTimes(1);
  });

  it('the manual tile reads Quick add and its spoken label says it opens manual entry (RF968-W3, RF968-W4)', async () => {
    await show();
    const tools = screen.getByTestId('food-tools');
    const tile = within(tools).getByRole('button', { name: 'Quick add, enter a food manually' });
    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.accessibilityLabel).toBe('Quick add, enter a food manually');
    expect(within(tile).getByText('Quick add').props.children).toBe('Quick add');
    expect(within(tools).queryAllByText(/Enter manually/i, { includeHiddenElements: true })).toHaveLength(0);
    await fireEvent.press(tile);
    expect(handlers.onEnterManualMode).toHaveBeenCalledTimes(1);
  });

  it('Recent could not load: the line names the tile by its words, and the tile is on screen (RF968-W3)', async () => {
    await show({ recentFoods: [], browseUnavailable: true });
    expect(screen.getByText('Recent foods could not load')).toBeTruthy();
    expect(screen.getByText('Check the connection, or tap Quick add to save this food now.')).toBeTruthy();
    expect(within(screen.getByTestId('food-tools')).getByText('Quick add')).toBeTruthy();
  });

  it('the search line: .c-search :112 gap 10, 1.5 pt ink underline, 50 tall, Inter 17 muted placeholder, 22 pt magnifier', async () => {
    await show();
    const line = screen.getByTestId('food-search-line');
    expect(flat(line)).toMatchObject({ gap: 10, borderBottomWidth: 1.5, borderBottomColor: lightTokens.textPrimary, minHeight: 50 });
    const input = screen.getByPlaceholderText('Search foods...');
    expect(input.props.placeholderTextColor).toBe(lightTokens.textMuted);
    expect(flat(input)).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 17 });
    expect(svgsIn(line)[0].props).toMatchObject({ width: 22, height: 22, stroke: lightTokens.textMuted, strokeWidth: 1.6 });
  });

  it('the tabs: .c-tabs :113-115 gap 22, 10 above, a 1 pt line, Inter 500 15, muted then ink with a 2 pt gold underline', async () => {
    await show();
    expect(flat(screen.getByTestId('food-search-tabs'))).toMatchObject({ gap: 22, marginTop: 10, borderBottomWidth: 1, borderBottomColor: lightTokens.border });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => within(t).getByText(/./).props.children)).toEqual(['Recent', 'Frequent']);
    expect(flat(tabs[0])).toMatchObject({ minHeight: 44, borderBottomWidth: 2, borderBottomColor: gold[300] });
    expect(flat(tabs[1])).toMatchObject({ minHeight: 44, borderBottomColor: 'transparent' });
    expect(flat(within(tabs[0]).getByText('Recent'))).toMatchObject({ fontFamily: 'Inter_500Medium', fontSize: 15, color: lightTokens.textPrimary });
    expect(flat(within(tabs[1]).getByText('Frequent'))).toMatchObject({ fontFamily: 'Inter_500Medium', fontSize: 15, color: lightTokens.textMuted });
  });

  it('a row: .c-li :116-119 gap 12, 56 tall, padding 6 0, a line under; name Cormorant 500 18/23.4; line Inter 13 muted; calories Inter 500 14 charcoal', async () => {
    await show();
    const row = screen.getByLabelText('Greek yoghurt, plain, 200 g, 20 g protein, 118 kcal');
    expect(flat(row)).toMatchObject({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: lightTokens.border });
    expect(flat(within(row).getByText('Greek yoghurt, plain'))).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 18,
      lineHeight: 23.4, color: lightTokens.textPrimary });
    expect(flat(within(row).getByText('200 g, 20 g protein'))).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18.2,
      color: lightTokens.textMuted });
    expect(flat(within(row).getByText('118'))).toMatchObject({ fontFamily: 'Inter_500Medium', fontSize: 14, color: palette.charcoal });
  });

  it('a row with no photo: .c-li .ph :120 the cream 48 pt tile at corner 12 with the drawn bowl, 30 pt camel at 1.5, hidden from the reader', async () => {
    expect(getFoodImageUrl('Greek yoghurt, plain')).toBe('');
    expect(getFoodImageUrl('Flat white')).toBe('');
    await show();
    for (const label of ['Greek yoghurt, plain, 200 g, 20 g protein, 118 kcal', /^Flat white, /]) {
      const row = screen.getByLabelText(label);
      const tile = within(row).getByTestId('food-tile-drawing', { includeHiddenElements: true });
      expect(flat(tile)).toMatchObject({ width: 48, height: 48, borderRadius: radius.input, backgroundColor: palette.cream });
      expect(tile.props.accessibilityElementsHidden).toBe(true);
      expect(tile.props.importantForAccessibility).toBe('no-hide-descendants');
      const [svg] = svgsIn(tile);
      expect(svg.props).toMatchObject({ width: 30, height: 30, stroke: palette.camel, strokeWidth: 1.5 });
      expect(svgsIn(tile, 'Ellipse')).toHaveLength(1);
      expect(svgsIn(tile, 'Path')).toHaveLength(2);
      expect(within(row).queryByText(/^[A-Z]$/)).toBeNull();
    }
  });

  it('a row with a photo draws the photo (the food\'s own image_url, m#968), the stock photo where one exists, and no bowl', async () => {
    expect(getFoodImageUrl('Banana')).not.toBe('');
    await show();
    const own = screen.getByLabelText(/^Oat drink, /);
    expect(imageUris(own)).toEqual([offPick.image_url]);
    expect(within(own).queryByTestId('food-tile-drawing', { includeHiddenElements: true })).toBeNull();
    const ownTile = own.queryAll((x: Node) => x.type === 'Image')[0];
    expect(flat(ownTile)).toMatchObject({ width: 48, height: 48, borderRadius: radius.input });
    const stock = screen.getByLabelText(/^Banana, /);
    expect(imageUris(stock)).toEqual([getFoodImageUrl('Banana')]);
    expect(within(stock).queryByTestId('food-tile-drawing', { includeHiddenElements: true })).toBeNull();
  });
});

describe('no control for a feature phone main lacks, in any state (negatives)', () => {
  const states: Array<[string, Over]> = [
    ['Recent', {}],
    ['Frequent', { recentTab: 'frequent' }],
    ['Recent empty', { recentFoods: [] }],
    ['Recent could not load', { recentFoods: [], browseUnavailable: true }],
    ['search with results', { searchQuery: 'oat', searchResults: [offPick] }],
    ['did you mean', { searchQuery: 'banan', didYouMean: [banana] }],
    ['no results', { searchQuery: 'zzz' }],
    ['search error', { searchQuery: 'zzz', searchError: 'Food search could not load' }],
    ['slow search', { searchQuery: 'oat', searching: true, showSlowMessage: true }],
    ['the repeat card', { repeatMeal: { date: '2026-10-12', calories: 300, entries: [{ foodItemId: 'gy', name: 'Greek yoghurt, plain', calories: 118, quantityMultiplier: 2 }] }, repeatMealTitle: 'Last snack', onRepeatMeal: handlers.onRepeatMeal }],
    ['the Extras Add with the meal row', { onMealChange: handlers.onMealChange, savesToday: () => true }],
    ['Added with Done', { addedFoodName: 'Banana' }],
    ['the manual form', { manualMode: true, manualFields: { foodName: 'Oat bar', calories: '190', protein: '4', carbs: '30', fat: '6', quantity: '1', unit: 'serving' } }],
    ['the portion picker', { portionPicker: portion }],
    ['a past day', { savesToday: () => false }],
    ['saving', { saving: true }],
  ];
  it.each(states)('%s: no Photo of a meal, Scan a barcode, Favourites or Saved meals', async (_name, over) => {
    await show(over);
    const missing = /Photo of a meal|Scan a barcode|Favourites|Favorites|Saved meals/i;
    expect(screen.queryAllByText(missing, { includeHiddenElements: true })).toHaveLength(0);
    expect(screen.queryAllByLabelText(missing, { includeHiddenElements: true })).toHaveLength(0);
  });

  it.each(states.filter(([, o]) => !o.saving && !o.portionPicker))('%s: every pressable does something (KT-3)', async (_name, over) => {
    await show(over);
    const pressables = [
      ...screen.queryAllByRole('button'), ...screen.queryAllByRole('tab'), ...screen.queryAllByRole('radio'),
      ...screen.queryAllByText('Try again'), dimOf(),
    ];
    const dead: string[] = [];
    for (const p of pressables) {
      if (p.props.accessibilityState?.disabled) continue; // announced as unavailable, not a dead tap
      jest.clearAllMocks();
      await fireEvent.press(p);
      const called = Object.values(handlers).some((h) => h.mock.calls.length > 0);
      if (!called) dead.push(String(p.props.accessibilityLabel ?? p.props.testID ?? JSON.stringify(p.props.children)));
    }
    expect(dead).toEqual([]);
  });
});

describe('mounted on the Food tab (LogScreen\'s guard)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 9, 13, 15, 10, 0), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
      'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance',
      'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
  });

  it('opens today as "Add at 3:10 pm" over Breakfast, and while a food saves the dim, the drag and Back leave it open', async () => {
    let finish: (v: unknown) => void = () => undefined;
    jest.mocked(logApi.logFood).mockImplementation(() => new Promise((resolve) => { finish = resolve; }) as never);
    await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LogScreen />
      </QueryClientProvider>,
    );
    await fireEvent.press(await screen.findByTestId('food-day-first-breakfast'));
    expect(screen.getByTestId('food-search-title')).toHaveTextContent('Add at 3:10 pm');
    expect(screen.getByTestId('food-search-meal')).toHaveTextContent('Breakfast');
    await fireEvent.press(await screen.findByText('Rolled oats'));
    await fireEvent.press(await screen.findByTestId('quantity-log-food'));
    expect(logApi.logFood).toHaveBeenCalledTimes(1);
    await fireEvent.press(dimOf());
    const zone = screen.getByTestId('food-search-drag');
    await fireEvent(zone, 'touchStart', { nativeEvent: { pageY: 100 } });
    await fireEvent(zone, 'responderRelease', { nativeEvent: { pageY: 300 } });
    await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose');
    expect(screen.getByTestId('food-search-sheet').props.visible).toBe(true);
    expect(screen.getByTestId('quantity-log-food')).toBeTruthy();
    await act(async () => { finish({ data: {} }); });
  });
});
