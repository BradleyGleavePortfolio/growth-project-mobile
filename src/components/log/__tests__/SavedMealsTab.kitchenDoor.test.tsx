/**
 * KITCHEN-DOOR-M (PICK #ALM-P2 "door from food", DOORS frame 2), the tab alone: the add sheet's body (FoodSearchView)
 * given its saved part shows a third tab, Saved meals, with her saved meals read under the Kitchen's own key; each row's
 * numbers stand only on foods whose food_truth is 'ok' (R5); the loading, failed and empty states and the not-added line
 * are the sheet's own family with the Kitchen's words (R9, D2 to D4, D7); Open Kitchen sits under the list in every
 * state (R8). The sheet without the saved part is main's, two tabs. The server is mocked at the api module's edge.
 * Fixtures are KITCHEN-M's (fictional: client Jordan, coach Sam).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { AccessibilityInfo, AppState, Platform, StyleSheet, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FoodSearchView from '../FoodSearchView';
import { gold } from '../../../theme/tokens';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true,
    clientPathCopilot: true, romanChat: true } };
});
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() } }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));
// Case 10's navigator half: the real ClientNavigator (real tab and stack routers) with stub leaves, as
// src/navigation/__tests__/trainOpensYouStack131.test.tsx mounts it (copied here, that file untouched).
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
const mockUser = { id: 'jordan', role: 'client' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../../components/community/UnreadBadge', () => () => null);
jest.mock('../../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (s: unknown) => s }));
jest.mock('../../../entitlements/dunning/UpdateCardScreen', () => () => null);
jest.mock('../../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (s: unknown) => s }));

// ---------- fixtures (KITCHEN-M's world: client Jordan, coach Sam) ----------
let k = 0;
const food = (name: string, calories: number, protein: number, m: number, qty: number | null, unit: string | null, truth: string | null = 'ok') => {
  k += 1;
  return { id: `i${k}`, saved_meal_id: 'm', food_item_id: `f${k}`, quantity_multiplier: m, original_quantity: qty, original_unit: unit,
    position: k, food_item: { id: `f${k}`, name, calories, protein_g: protein, carbs_g: 0, fat_g: 0 }, ...(truth === null ? {} : { food_truth: truth }) };
};
const meal = (id: string, name: string, items: unknown[] | undefined) =>
  ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', ...(items ? { items } : {}) });
const MEALS = (truth: string | null = 'held') => [
  meal('m1', 'Usual breakfast', [food('Greek yoghurt, plain', 59, 12, 2.0, 200, 'g'), food('Rolled oats', 379, 13.2, 0.5, 50, 'g'),
    food('Blueberries', 57, 0.7, 0.8, 80, 'g'), food('Honey', 314, 0.3, 0.21, 1, 'tsp')]),
  meal('m2', 'Post-gym shake', [food('Whey', 240, 26, 1, 1, 'scoop'), food('Banana', 100, 4, 1, 1, 'medium')]),
  meal('m3', 'Friday wrap', [food('Chicken wrap', 565, 38, 1, null, null)]),
  meal('m4', 'Pantry bar', [food('Oat bar', 190, 6, 1, null, null), food('Mystery bar', 250, 9, 1, null, null, truth)]),
  meal('m5', 'Old cereal', [food('Old flakes', 0, 0, 1, 40, 'g', 'legacy_zero')]),
  meal('m6', 'Gone lunch', []),
];
const RECENT = [{ id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5, serving_size_grams: 40,
  nutrient_basis: 'PER_100G', supports_volume_units: false }];
const FREQUENT = [{ ...RECENT[0], id: 'banana', name: 'Banana' }];
const REPEAT = { date: '2026-11-04', calories: 228, entries: [{ name: 'Rolled oats', foodItemId: 'oats', quantityMultiplier: 0.6 }] };

// FoodSearchView reached through the sheet's own props, so every case runs against any base (props it does not know
// are ignored there, and each case then fails on its own assertion).
const View = FoodSearchView as unknown as React.ComponentType<Record<string, unknown>>;
const onAdd = jest.fn();
const onOpenKitchen = jest.fn();
const onTab = jest.fn();
type Part = Record<string, unknown>;
const part = (over: Part = {}): Part => ({ mealType: 'breakfast', onAdd, savingId: null, failure: null, onOpenKitchen, ...over });
let client: QueryClient;
function sheet(over: Record<string, unknown> = {}, saved: Part | null = part()) {
  return (
    <QueryClientProvider client={client}>
      <View searchQuery="" onSearchChange={jest.fn()} onClearSearch={jest.fn()} onRetrySearch={jest.fn()} searching={false}
        showSlowMessage={false} searchError={null} searchResults={[]} didYouMean={[]} recentTab="saved" onRecentTabChange={onTab}
        recentFoods={RECENT} frequentFoods={FREQUENT} onSelectFood={jest.fn()} onEnterManualMode={jest.fn()}
        {...(saved ? { saved } : {})} {...over} />
    </QueryClientProvider>
  );
}
const listReads = () => mockGet.mock.calls.filter(([u]) => u === '/me/foods/saved-meals').length;
const flat = (n: { props: { style?: unknown } }) => (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;
type Host = { type: unknown; props: Record<string, unknown>; queryAll: (match: (n: Host) => boolean) => Host[] };
const hostsIn = (n: unknown, match: (h: Host) => boolean) => (n as Host).queryAll(match);
const rowOf = (name: string) => screen.getByTestId(`saved-meal-${MEALS().find((m) => m.name === name)!.id}`);

beforeEach(() => {
  jest.clearAllMocks();
  k = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockGet.mockImplementation(async (url: string) => (url === '/me/foods/saved-meals' ? { data: MEALS() } : { data: {} }));
});
afterEach(() => client.clear());

describe('case 1: the tabs', () => {
  it('with the saved part: Recent, Frequent, Saved meals, each a tab with its selected state', async () => {
    await render(sheet({ recentTab: 'recent' }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => within(t).getByText(/./).props.children)).toEqual(['Recent', 'Frequent', 'Saved meals']);
    expect(tabs.map((t) => t.props.accessibilityState?.selected)).toEqual([true, false, false]);
    await fireEvent.press(tabs[2]);
    expect(onTab).toHaveBeenCalledWith('saved');
  });

  it('without the saved part the sheet is main\'s: exactly two tabs, and no saved meals are read', async () => {
    await render(sheet({ recentTab: 'recent' }, null));
    expect(screen.getAllByRole('tab').map((t) => within(t).getByText(/./).props.children)).toEqual(['Recent', 'Frequent']);
    expect(listReads()).toBe(0);
  });

  it('with Saved meals chosen the list is the tab\'s: no Recent or Frequent row, no Recent or Frequent empty line', async () => {
    await render(sheet({ recentFoods: [], frequentFoods: [] }));
    await screen.findByText('Usual breakfast');
    expect(screen.getAllByRole('tab')[2].props.accessibilityState?.selected).toBe(true);
    expect(screen.getAllByRole('tab')[2]).toBeTruthy();
    expect(screen.queryByText('Rolled oats')).toBeNull();
    expect(screen.queryByText('No foods logged in the last 7 days')).toBeNull();
    expect(screen.queryByText('No frequent foods yet')).toBeNull();
  });

  it('searching (two letters) hides the tabs and shows results; the tab she was on stays chosen for when it clears', async () => {
    const results = [{ ...RECENT[0], id: 's1', name: 'Salmon fillet' }];
    await render(sheet({ searchQuery: 'sa', searchResults: results }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText('Salmon fillet')).toBeTruthy();
    expect(screen.queryByText('Usual breakfast')).toBeNull();
    await screen.rerender(sheet({ searchQuery: '' }));
    expect(await screen.findByText('Usual breakfast')).toBeTruthy();
  });
});

describe('case 2: the rows', () => {
  it('her meals in the server\'s order, each a button with its foods line, kcal and protein, spoken label and hint', async () => {
    await render(sheet());
    await screen.findByText('Usual breakfast');
    const rows = screen.getAllByTestId(/^saved-meal-m\d$/);
    expect(rows.map((r) => r.props.testID)).toEqual(['saved-meal-m1', 'saved-meal-m2', 'saved-meal-m3', 'saved-meal-m4', 'saved-meal-m5', 'saved-meal-m6']);
    const first = rowOf('Usual breakfast');
    expect(first.props.accessibilityRole).toBe('button');
    expect(within(first).getByText('Greek yoghurt, plain, Rolled oats, Blueberries and 1 more')).toBeTruthy();
    expect(within(first).getByText(/^420/)).toBeTruthy();
    expect(within(first).getByText(/kcal/)).toBeTruthy();
    expect(within(first).getByText('32 g protein')).toBeTruthy();
    expect(first.props.accessibilityLabel)
      .toBe('Usual breakfast, 420 kcal, 32 g protein, Greek yoghurt, plain, Rolled oats, Blueberries and 1 more');
    expect(first.props.accessibilityHint).toBe('Adds it to breakfast');
    expect(rowOf('Post-gym shake').props.accessibilityLabel).toBe('Post-gym shake, 340 kcal, 30 g protein, Whey and Banana');
    expect(rowOf('Friday wrap').props.accessibilityLabel).toBe('Friday wrap, 565 kcal, 38 g protein, Chicken wrap');
  });

  it('the hint names the sheet\'s meal (Snacks for a snack)', async () => {
    await render(sheet({}, part({ mealType: 'snack' })));
    expect((await screen.findByTestId('saved-meal-m1')).props.accessibilityHint).toBe('Adds it to snacks');
  });

  it('no thumbnail tile on a row (none is drawn, 201-S3)', async () => {
    await render(sheet());
    const first = await screen.findByTestId('saved-meal-m1');
    expect(hostsIn(first, (n) => n.type === 'Image' || n.props.testID === 'food-thumb')).toHaveLength(0);
  });

  it('a press adds that meal, and the rows scroll in a host that passes the first tap with the keyboard up', async () => {
    await render(sheet());
    await fireEvent.press(await screen.findByTestId('saved-meal-m1'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ id: 'm1', name: 'Usual breakfast' });
    expect(screen.getByTestId('saved-meals').props.keyboardShouldPersistTaps).toBe('handled');
  });
});

describe('case 3: truth (R5)', () => {
  it.each([['held'], [null]])('a meal with a food not ok (%s) shows no kcal or protein anywhere, KK-2 and KK-4, and still adds', async (truth) => {
    mockGet.mockImplementation(async () => ({ data: MEALS(truth) }));
    await render(sheet());
    const bar = await waitFor(() => rowOf('Pantry bar'));
    expect(within(bar).getByText('No total')).toBeTruthy();
    expect(within(bar).getByText('Numbers for Mystery bar are held back here, so this meal has no total. Adding it checks the food again.')).toBeTruthy();
    expect(within(bar).queryByText(/kcal/)).toBeNull();
    expect(within(bar).queryByText(/protein/)).toBeNull();
    expect(within(bar).queryByText(/190|250|440/)).toBeNull();
    expect(bar.props.accessibilityLabel).toBe('Pantry bar, no total: numbers held back for 1 of its foods, Oat bar and Mystery bar, '
      + 'Numbers for Mystery bar are held back here, so this meal has no total. Adding it checks the food again.');
    expect(bar.props.accessibilityRole).toBe('button');
    await fireEvent.press(bar);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ id: 'm4' });
  });

  it('a legacy-zero food: no 0 kcal, KK-2 and KK-4, and it still adds', async () => {
    await render(sheet());
    const cereal = await waitFor(() => rowOf('Old cereal'));
    expect(within(cereal).getByText('No total')).toBeTruthy();
    expect(within(cereal).getByText('Numbers for Old flakes are held back here, so this meal has no total. Adding it checks the food again.')).toBeTruthy();
    expect(within(cereal).queryByText(/kcal|protein|^0/)).toBeNull();
    await fireEvent.press(cereal);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ id: 'm5' });
  });

  it('an older server (no food_truth on any food) shows no number in the tab at all', async () => {
    mockGet.mockImplementation(async () => ({ data: MEALS(null).map((m) => ({ ...m, items: (m.items as Array<Record<string, unknown>> | undefined)
      ?.map(({ food_truth: _t, ...rest }) => rest) })) }));
    await render(sheet());
    await screen.findByText('Usual breakfast');
    expect(screen.queryAllByText(/kcal|g protein/)).toHaveLength(0);
    expect(screen.getAllByText('No total').length).toBe(5);
  });
});

describe('case 7 and D9: a meal with no foods left', () => {
  it('Gone lunch reads KK-8a, has no total, is not a button and sends nothing', async () => {
    await render(sheet());
    const gone = await waitFor(() => rowOf('Gone lunch'));
    expect(within(gone).getByText('No foods left in this meal')).toBeTruthy();
    expect(within(gone).queryByText('No total')).toBeNull();
    expect(gone.props.accessibilityRole).toBeUndefined();
    expect(gone.props.onPress).toBeUndefined();
    expect(gone.props.accessibilityLabel).toBe('Gone lunch, No foods left in this meal');
    await fireEvent.press(gone);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('a meal whose items list is missing reads as no foods, never a crash', async () => {
    mockGet.mockImplementation(async () => ({ data: [meal('m9', 'Odd meal', undefined)] }));
    await render(sheet());
    expect(await screen.findByText('No foods left in this meal')).toBeTruthy();
  });
});

describe('case 8: the tab\'s own states (R9), with Open Kitchen under each', () => {
  it('D2 loading: three still rows read once as "Loading saved meals"; Open Kitchen under them', async () => {
    mockGet.mockImplementation(() => new Promise(() => undefined));
    await render(sheet());
    const loading = await screen.findByLabelText('Loading saved meals');
    expect(loading).toBeTruthy();
    expect(screen.queryByText('No saved meals yet')).toBeNull();
    expect(screen.getByTestId('saved-meals-open-kitchen')).toBeTruthy();
  });

  it('D3 failed: KM-14 over main\'s line and Try again, which reads again; never the empty words; Open Kitchen under it', async () => {
    mockGet.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: undefined }));
    await render(sheet());
    expect(await screen.findByText('Couldn\'t load saved meals')).toBeTruthy();
    expect(screen.getByText('Check the connection and try again.')).toBeTruthy();
    expect(screen.queryByText('No saved meals yet')).toBeNull();
    expect(screen.queryByText(/^0/)).toBeNull();
    expect(screen.getByTestId('saved-meals-open-kitchen')).toBeTruthy();
    const before = listReads();
    await fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Usual breakfast');
    expect(listReads()).toBe(before + 1);
  });

  it('an answer that is not a list is a failed read, never "No saved meals yet"', async () => {
    mockGet.mockImplementation(async () => ({ data: { meals: [] } }));
    await render(sheet());
    expect(await screen.findByText('Couldn\'t load saved meals')).toBeTruthy();
    expect(screen.queryByText('No saved meals yet')).toBeNull();
  });

  it('rows read earlier stay on a failed refresh, with no notice of their own', async () => {
    await render(sheet());
    await screen.findByText('Usual breakfast');
    mockGet.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: undefined }));
    await act(async () => { await client.refetchQueries({ queryKey: ['me', 'foods', 'saved-meals'] }); });
    expect(screen.getByText('Usual breakfast')).toBeTruthy();
    expect(screen.queryByText('Couldn\'t load saved meals')).toBeNull();
  });

  it('D4 empty: "No saved meals yet" over KM-7\'s second sentence; Open Kitchen under it', async () => {
    mockGet.mockImplementation(async () => ({ data: [] }));
    await render(sheet());
    expect(await screen.findByText('No saved meals yet')).toBeTruthy();
    expect(screen.getByText('Save one you eat often and log it again in two taps.')).toBeTruthy();
    expect(screen.getByTestId('saved-meals-open-kitchen')).toBeTruthy();
  });

  it('D1: Open Kitchen under her meals, centred, underlined, accent, 44 pt, with its hint; it calls the sheet\'s door', async () => {
    await render(sheet());
    await screen.findByText('Usual breakfast');
    const open = screen.getByTestId('saved-meals-open-kitchen');
    expect(open.props.accessibilityLabel).toBe('Open Kitchen');
    expect(open.props.accessibilityHint).toBe('Opens your kitchen');
    expect(open.props.accessibilityRole).toBe('button');
    expect(flat(open as never)).toMatchObject({ minHeight: 44, alignSelf: 'center' });
    expect(flat(within(open).getByText('Open Kitchen') as never)).toMatchObject({ textDecorationLine: 'underline' });
    await fireEvent.press(open);
    expect(onOpenKitchen).toHaveBeenCalledTimes(1);
  });

  it('no Open Kitchen where the sheet passes none (outside a navigator, or a sheet on the Kitchen itself)', async () => {
    await render(sheet({}, part({ onOpenKitchen: undefined })));
    await screen.findByText('Usual breakfast');
    expect(screen.queryByText('Open Kitchen')).toBeNull();
  });
});

describe('D5: adding (one save at a time)', () => {
  it('the tapped row spins and reads busy, every row and Open Kitchen are off, and Repeat keeps "Add all" with no spinner', async () => {
    await render(sheet({ saving: true, repeatMeal: REPEAT, repeatMealTitle: 'Repeat yesterday\'s breakfast', onRepeatMeal: jest.fn() },
      part({ savingId: 'm1' })));
    await screen.findByText('Usual breakfast');
    const first = rowOf('Usual breakfast');
    expect(first.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(within(first).getByTestId('saved-meal-busy')).toBeTruthy();
    expect(within(first).queryByText(/kcal/)).toBeNull();
    expect(rowOf('Friday wrap').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('saved-meals-open-kitchen').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Add all')).toBeTruthy();
    const repeatButton = screen.getByLabelText('Repeat yesterday\'s breakfast: add all 1 food');
    expect(repeatButton.props.accessibilityState?.disabled ?? repeatButton.props.disabled).toBeTruthy();
    await fireEvent.press(rowOf('Friday wrap'));
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('D7: not added, one line at the top of the list', () => {
  const lost = (outcome: string) => part({ failure: { meal: MEALS()[0], outcome } });
  it.each([
    ['food-not-found', 'A food in this meal can no longer be logged, so nothing was added.', false],
    ['lost', 'This meal was not added. Check the connection and try again.', true],
    ['refused', 'This meal was not added. Check the connection and try again.', false],
    ['meal-gone', 'This meal is no longer saved.', false],
    ['empty', 'Its foods were removed, so there is nothing to add.', false],
    ['offline', 'Adding a saved meal needs a connection. Nothing was added.', false],
  ])('%s: its line, role alert, read once on iOS; Try again only for a lost answer', async (outcome, words, retry) => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const say = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    await render(sheet({}, lost(outcome)));
    await screen.findByText('Usual breakfast');
    const line = screen.getByTestId('saved-meals-failure');
    expect(within(line).getByText(words)).toBeTruthy();
    expect(line.props.accessibilityRole).toBe('alert');
    expect(say.mock.calls.filter(([w]) => w === words)).toHaveLength(1);
    expect(!!within(line).queryByText('Try again')).toBe(retry);
    expect(screen.getByText('Usual breakfast')).toBeTruthy();
    if (retry) {
      await fireEvent.press(within(line).getByText('Try again'));
      expect(onAdd.mock.calls[0][0]).toMatchObject({ id: 'm1' });
    }
  });
});

describe('case 13: 320 pt at 130% (style props; the wrap itself is shown by the web render)', () => {
  it('the tab row wraps, each tab and Open Kitchen at least 44 pt, and no text of the tab is cut', async () => {
    await render(sheet());
    await screen.findByText('Usual breakfast');
    const row = screen.getByTestId('food-search-tabs');
    expect(flat(row as never)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', gap: 22, borderBottomWidth: 1 });
    screen.getAllByRole('tab').forEach((t) => expect(flat(t as never)).toMatchObject({ minHeight: 44 }));
    expect(flat(screen.getAllByRole('tab')[2] as never)).toMatchObject({ borderBottomWidth: 2, borderBottomColor: gold[300] });
    expect(flat(screen.getByTestId('saved-meals-open-kitchen') as never)).toMatchObject({ minHeight: 44 });
    const tab = screen.getByTestId('saved-meals');
    expect(hostsIn(tab, (n) => n.props.numberOfLines != null)).toHaveLength(0);
    // Open Kitchen is the list's footer: at the end of the rows' scroll (D1's rule, choice (b)).
    expect(tab.props.ListFooterComponent).toBeTruthy();
  });
});

describe('case 14: guards (green by design; a guard is not a mutation proof)', () => {
  it('the new file holds no colour literal and no pale green family name', () => {
    const file = path.join(__dirname, '..', 'SavedMealsTab.tsx');
    const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    expect(src).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/);
    expect(src).not.toMatch(/rgba?\(/);
    expect(src).not.toMatch(/surface\.sage|sageLine/);
  });
});

describe('case 10, the navigator half: Open Kitchen\'s call never leaves two Kitchens in the You stack (R8)', () => {
  type StateLike = { routes: Array<{ name: string; state?: StateLike }> };
  const youStack = (st: unknown) => ((st as StateLike).routes.find((r) => r.name === 'MoreTab')?.state?.routes ?? []).map((r) => r.name);
  const OPEN_KITCHEN = ['MoreTab', { screen: 'Kitchen', initial: false, pop: true }] as const;
  let ClientNavigator: React.ComponentType;
  beforeAll(() => {
    const fsMod = jest.requireActual<typeof fs>('fs');
    const src = fsMod.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
    for (const m of src.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
      const name = m[1];
      jest.doMock(`../../../${name.slice(3)}`, () => ({ __esModule: true, default: () => <Text testID="destination">{name}</Text> }));
    }
    jest.doMock('../../../navigation/CommunityNavigator', () => ({ __esModule: true, default: () => null }));
    ClientNavigator = require('../../../navigation/ClientNavigator').default;
  });
  beforeEach(() => { jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }) as never); });

  async function start(before: Array<readonly [string, object?]>) {
    const ref = createNavigationContainerRef<Record<string, object | undefined>>();
    await render(<NavigationContainer ref={ref}><ClientNavigator /></NavigationContainer>);
    for (const [name, params] of before) await act(async () => ref.navigate(name as never, params as never));
    await act(async () => ref.navigate('Log'));
    await act(async () => ref.navigate(...(OPEN_KITCHEN as unknown as [never, never])));
    return ref;
  }
  it('from You never opened, and from the You home: You, then the Kitchen; Back lands on You', async () => {
    const cold = await start([]);
    await waitFor(() => expect(youStack(cold.getRootState())).toEqual(['MoreIndex', 'Kitchen']));
    const home = await start([['MoreTab']]);
    await waitFor(() => expect(youStack(home.getRootState())).toEqual(['MoreIndex', 'Kitchen']));
    await act(async () => home.goBack());
    await waitFor(() => expect(youStack(home.getRootState())).toEqual(['MoreIndex']));
  });
  it('from the Kitchen (its Log food opened the Food tab): back to that one Kitchen', async () => {
    const ref = await start([['MoreTab', { screen: 'Kitchen', initial: false }]]);
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'Kitchen']));
  });
  it('from Recipes over the Kitchen: Recipes goes, the one Kitchen shows', async () => {
    const ref = await start([['MoreTab', { screen: 'Kitchen', initial: false }], ['MoreTab', { screen: 'Recipes' }]]);
    await waitFor(() => expect(youStack(ref.getRootState())).toEqual(['MoreIndex', 'Kitchen']));
  });
});
