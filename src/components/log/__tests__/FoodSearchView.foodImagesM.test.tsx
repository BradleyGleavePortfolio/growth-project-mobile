/**
 * FOOD-IMAGES-M cases f, g and h on the real add sheet rows (FoodRow, FoodSearchView.tsx:87-106) with the real FoodImage,
 * fed by the real mappers: search results (mapFoodItem, LogScreen.tsx:290, :294), Did you mean, Recent and Frequent
 * (mapLogEntryToFood through useFoodBrowse.ts:150) and the kept browse copy (browseCache.ts). The promise: the food's own
 * image_url photo while it loads, else the stock photo where its name has one, else its group's drawing (one of the five
 * picked C2 Style C drawings), else the bowl; never a letter, never an empty tile. Names, ids and photo addresses are
 * made up; groups are the USDA groups the server stores as category: tags (seed-built-in-foods.ts:56, load-usda-foods.ts:73-77).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react-native';
import FoodSearchView from '../FoodSearchView';
import { useFoodBrowse } from '../../../hooks/useFoodBrowse';
import { logApi } from '../../../services/api';
import { mapFoodItem } from '../../../utils/log/mapFoodItem';
import { keepBrowseCopy, readBrowseCopy } from '../../../utils/log/browseCache';
import { getFoodImageUrl } from '../../../utils/foodImages';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({ __esModule: true, logApi: { getDaily: jest.fn() } }));
// The drawn parts as plain host views carrying their svg props (as FoodSearchModal.refine968.test.tsx:30-35 does).
jest.mock('react-native-svg', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const part = (kind: string) => (p: Record<string, unknown>) => R.createElement(View, { ...p, svgKind: kind });
  return { __esModule: true, default: part('Svg'), Svg: part('Svg'), Path: part('Path'), Ellipse: part('Ellipse'), Circle: part('Circle') };
});

type Node = { type: string; props: Record<string, any>; queryAll: (m: (n: Node) => boolean) => Node[] };
const hidden = { includeHiddenElements: true };
const getDaily = logApi.getDaily as jest.MockedFunction<typeof logApi.getDaily>;
const MACROS = { calories: 100, protein_g: 5, carbs_g: 10, fat_g: 2, serving_description: '100 g', serving_size_grams: 100, nutrient_basis: 'PER_100G' };
// A stored row as GET /foods/search and GET /log/daily send it (food.service.ts toResult: category the column, tags whole).
const stored = (id: string, name: string, group?: string, extra: object = {}) =>
  ({ id, name, category: 'generic', tags: group ? [`usda:${id}`, `category:${group}`, 'basic-food'] : [], image_url: null, ...MACROS, ...extra });
const viaMapper = (raw: object): SearchResult => mapFoodItem(raw as any);
const PHOTO = 'https://images.example.test/oat-crunch.jpg';

// S2: one row per kind (no stock photo for these names), an Open Food Facts product with its photo, a custom food.
const S2 = [
  stored('171890', 'Beverages, coffee, brewed', 'Beverages'),
  stored('169098', 'Orange juice, raw', 'Fruits and Fruit Juices'),
  stored('173904', 'Oats, rolled, dry', 'Cereal Grains and Pasta'),
  stored('170894', 'Greek yogurt, plain, nonfat', 'Dairy and Egg Products'),
  stored('171477', 'Chicken breast, cooked, roasted', 'Poultry Products'),
];
const KIND_OF: Record<string, string> = {
  'Beverages, coffee, brewed': 'cup', 'Orange juice, raw': 'glass', 'Oats, rolled, dry': 'bowl',
  'Greek yogurt, plain, nonfat': 'jar', 'Chicken breast, cooked, roasted': 'plate',
};
const OFF = { id: 'off1', name: 'Oat crunch bar', brand_or_restaurant: 'Madeup Mills', category: 'generic', tags: ['off:0000000000017'], ...MACROS, image_url: PHOTO };
const CUSTOM = { id: 'c1', name: 'My protein shake', category: 'generic', ...MACROS };

const view = (over: Partial<React.ComponentProps<typeof FoodSearchView>>) => render(
  <FoodSearchView
    searchQuery="" onSearchChange={jest.fn()} onClearSearch={jest.fn()} onRetrySearch={jest.fn()}
    searching={false} showSlowMessage={false} searchError={null} searchResults={[]} didYouMean={[]}
    recentTab="recent" onRecentTabChange={jest.fn()} recentFoods={[]} frequentFoods={[]}
    onSelectFood={jest.fn()} onEnterManualMode={jest.fn()} {...over}
  />,
);
const row = (name: string) => screen.getByLabelText(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `));
const imagesIn = (n: unknown) => (n as Node).queryAll((x) => x.type === 'Image');
const drawingIn = (n: unknown): string | null => {
  const tile = within(n as never).queryByTestId('food-tile-drawing', hidden);
  if (!tile) return null;
  const svgs = (tile as unknown as Node).queryAll((x) => x.props.svgKind === 'Svg');
  expect(svgs).toHaveLength(1);
  return svgs[0].props.testID ?? 'untagged';
};
/** What one row's tile shows: its photo's uri, or the drawing's testID, and never a letter. */
const tileOf = (name: string) => {
  const r = row(name);
  expect(within(r).queryByText(/^[A-Z?]$/)).toBeNull();
  const uris = imagesIn(r).map((i) => i.props.source?.uri);
  const drawing = drawingIn(r);
  expect(uris.length + (drawing ? 1 : 0)).toBe(1);
  return uris[0] ?? drawing;
};
// The bowl at main has no testID; with this job every drawing names its kind. Either way the parts are the bowl's.
const isBowl = (name: string) => {
  const tile = within(row(name)).getByTestId('food-tile-drawing', hidden) as unknown as Node;
  return tile.queryAll((x) => x.props.svgKind === 'Ellipse').length === 1 && tile.queryAll((x) => x.props.svgKind === 'Path').length === 2;
};

beforeAll(() => {
  for (const name of [...Object.keys(KIND_OF), 'Flat white', 'Greek yoghurt, plain', 'Rice cakes', 'My protein shake', 'Oat crunch bar']) {
    expect(getFoodImageUrl(name)).toBe('');
  }
  expect(getFoodImageUrl('Banana')).not.toBe('');
});
beforeEach(async () => {
  await AsyncStorage.clear();
  getDaily.mockReset();
});

describe('f. search results: one row per kind draws food-drawing-<kind> on the cream tile, no letter (red at the base)', () => {
  it('each of the five kinds on its own row', async () => {
    await view({ searchQuery: 'food', searchResults: S2.map(viaMapper) });
    for (const [name, kind] of Object.entries(KIND_OF)) expect([name, tileOf(name)]).toEqual([name, `food-drawing-${kind}`]);
  });

  it('Did you mean rows follow the same tile rule (S3)', async () => {
    await view({ searchQuery: 'cofee', didYouMean: S2.slice(0, 2).map(viaMapper) });
    expect(tileOf('Beverages, coffee, brewed')).toBe('food-drawing-cup');
    expect(tileOf('Orange juice, raw')).toBe('food-drawing-glass');
  });
});

describe('f. a row with the food\'s own photo (R2 a, R6)', () => {
  it('shows one Image of that uri and no drawing (green at both)', async () => {
    await view({ searchQuery: 'oat', searchResults: [viaMapper(OFF)] });
    expect(tileOf('Oat crunch bar')).toBe(PHOTO);
  });

  it('after that photo fails: its group\'s drawing where the name has no stock photo (red at the base: an empty tile)', async () => {
    const coffee = viaMapper({ ...S2[0], image_url: PHOTO });
    await view({ searchQuery: 'coffee', searchResults: [coffee] });
    expect(tileOf('Beverages, coffee, brewed')).toBe(PHOTO);
    await fireEvent(imagesIn(row('Beverages, coffee, brewed'))[0] as never, 'error');
    expect(tileOf('Beverages, coffee, brewed')).toBe('food-drawing-cup');
  });

  it('after that photo fails: the stock photo where the name has one, then its drawing if that fails too (red at the base)', async () => {
    const banana = viaMapper(stored('173944', 'Banana', 'Fruits and Fruit Juices', { image_url: PHOTO }));
    await view({ searchQuery: 'banana', searchResults: [banana] });
    await fireEvent(imagesIn(row('Banana'))[0] as never, 'error');
    expect(tileOf('Banana')).toBe(getFoodImageUrl('Banana'));
    await fireEvent(imagesIn(row('Banana'))[0] as never, 'error');
    expect(tileOf('Banana')).toBe('food-drawing-bowl');
  });

  it('an Open Food Facts photo that fails, no group: the bowl, never an empty tile (red at the base)', async () => {
    await view({ searchQuery: 'oat', searchResults: [viaMapper(OFF)] });
    await fireEvent(imagesIn(row('Oat crunch bar'))[0] as never, 'error');
    expect(isBowl('Oat crunch bar')).toBe(true);
  });

  it('the failed photo is the row\'s own: a new image_url on the same row shows again (red at the base: no fallback)', async () => {
    const coffee = (uri: string) => viaMapper({ ...S2[0], image_url: uri });
    const v = await view({ searchQuery: 'coffee', searchResults: [coffee(PHOTO)] });
    await fireEvent(imagesIn(row('Beverages, coffee, brewed'))[0] as never, 'error');
    expect(tileOf('Beverages, coffee, brewed')).toBe('food-drawing-cup');
    const NEXT = 'https://images.example.test/coffee-2.jpg';
    await v.rerender(
      <FoodSearchView
        searchQuery="coffee" onSearchChange={jest.fn()} onClearSearch={jest.fn()} onRetrySearch={jest.fn()}
        searching={false} showSlowMessage={false} searchError={null} searchResults={[coffee(NEXT)]} didYouMean={[]}
        recentTab="recent" onRecentTabChange={jest.fn()} recentFoods={[]} frequentFoods={[]}
        onSelectFood={jest.fn()} onEnterManualMode={jest.fn()}
      />,
    );
    expect(tileOf('Beverages, coffee, brewed')).toBe(NEXT);
  });
});

describe('g. R2: the stock photo stays ahead of the drawing (green at both)', () => {
  it('Banana with group Fruits and no image_url shows its stock photo; after that fails, the bowl (Fruits\' kind)', async () => {
    await view({ recentFoods: [viaMapper(stored('173944', 'Banana', 'Fruits and Fruit Juices'))] });
    expect(tileOf('Banana')).toBe(getFoodImageUrl('Banana'));
    await fireEvent(imagesIn(row('Banana'))[0] as never, 'error');
    expect(isBowl('Banana')).toBe(true);
  });
});

describe('h. no group and no photo: the bowl, as at main (green at both)', () => {
  it('a custom food (Quick add, Enter manually): no category tag, no photo', async () => {
    await view({ searchQuery: 'shake', searchResults: [viaMapper(CUSTOM)] });
    expect(isBowl('My protein shake')).toBe(true);
    expect(imagesIn(row('My protein shake'))).toHaveLength(0);
  });

  it('a browse copy kept before this change (no food_group): Recent draws the bowl until the next good read (S7, H4)', async () => {
    const old = { id: 'u1', name: 'Greek yoghurt, plain', calories: 59, protein: 10, carbs: 3.6, fat: 0.4, nutrient_basis: 'PER_100G' as const,
      food_category: 'generic', last_quantity: 200, last_unit: 'g', from_log: true };
    await keepBrowseCopy('member-old', { readFor: '2026-11-27', recentFoods: [old], frequentFoods: [], lastMeals: {} });
    const copy = await readBrowseCopy('member-old');
    await view({ recentFoods: copy!.recentFoods });
    expect(isBowl('Greek yoghurt, plain')).toBe(true);
  });
});

describe('S1 and S4: Recent and Frequent from the log carry the group (mapLogEntryToFood, useFoodBrowse.ts:150; red at the base)', () => {
  // The GOAL's Recent rows (C_add: Flat white cup, Banana bowl, Greek yoghurt plain jar, Rice cakes plate; style_c.py:177)
  // plus an Open Food Facts product with its own photo; Banana keeps its stock photo by R2.
  const GOAL = [
    stored('g1', 'Flat white', 'Beverages'),
    stored('g2', 'Banana', 'Fruits and Fruit Juices'),
    stored('g3', 'Greek yoghurt, plain', 'Dairy and Egg Products'),
    stored('g4', 'Rice cakes', 'Snacks'),
    OFF,
  ];
  const entry = (i: number, food: Record<string, unknown>) =>
    ({ id: `e${i}`, food_item_id: food.id, meal_type: 'snack', quantity_multiplier: 1, original_quantity: 100, original_unit: 'g', food_item: food });

  async function browse() {
    getDaily.mockImplementation(async (date: string) =>
      ({ data: { entries: date === '2026-11-27' ? GOAL.map((f, i) => entry(i, f)).reverse() : [] } }) as never);
    const hook = await renderHook(() => useFoodBrowse('member-goal', '2026-11-27'));
    await act(async () => { await hook.result.current.loadBrowseFoods(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return hook.result.current;
  }

  it('Recent: cup, the stock photo, jar, plate and the product photo, row for row', async () => {
    const browsed = await browse();
    await view({ recentFoods: browsed.recentFoods });
    expect(tileOf('Flat white')).toBe('food-drawing-cup');
    expect(tileOf('Banana')).toBe(getFoodImageUrl('Banana'));
    expect(tileOf('Greek yoghurt, plain')).toBe('food-drawing-jar');
    expect(tileOf('Rice cakes')).toBe('food-drawing-plate');
    expect(tileOf('Oat crunch bar')).toBe(PHOTO);
  });

  it('Frequent: the same rows, the same tiles', async () => {
    const browsed = await browse();
    await view({ recentTab: 'frequent', frequentFoods: browsed.frequentFoods });
    expect(tileOf('Flat white')).toBe('food-drawing-cup');
    expect(tileOf('Rice cakes')).toBe('food-drawing-plate');
  });

  it('the kept copy written after this change carries the group inside its existing key, and offline Recent draws it (S7)', async () => {
    await browse();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).toEqual(['food_browse_copy_member-goal']);
    const copy = await readBrowseCopy('member-goal');
    await view({ recentFoods: copy!.recentFoods });
    expect(tileOf('Flat white')).toBe('food-drawing-cup');
    expect(tileOf('Greek yoghurt, plain')).toBe('food-drawing-jar');
  });
});
