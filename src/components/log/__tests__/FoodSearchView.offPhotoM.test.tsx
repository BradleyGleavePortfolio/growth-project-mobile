// OFF-PHOTO-M cases 10 and 11 (guards, the same at main and here): after an Open Food Facts product is logged by
// its off_ id, the day read (GET /log/daily) returns the entry with the server's one shared row, image_url set
// (backend log.service.ts:75-83, food.service.ts:1270 at e24409bc). Recent, Frequent and a search after the log
// draw that photo; a private copy made by an older build has none and still draws the letter or stock tile, and
// still comes first in a search for its name and brand (OFF-COPIES-FOLD, v1.1: Found, not fixed).
// Codes, names and the photo address are made up.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, renderHook, screen } from '@testing-library/react-native';
import FoodSearchView from '../FoodSearchView';
import { useFoodBrowse } from '../../../hooks/useFoodBrowse';
import { logApi } from '../../../services/api';
import { mapFoodItem } from '../../../utils/log/mapFoodItem';
import { matchLoggedFoods, mergeWithLoggedMatches } from '../../../utils/log/quickLog';
import type { SearchResult } from '../../../utils/log/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({ __esModule: true, logApi: { getDaily: jest.fn() } }));
jest.mock('../../FoodImage', () => {
  const { createElement } = jest.requireActual('react');
  const { Text: MockText } = jest.requireActual('react-native');
  return { __esModule: true, default: ({ name }: { name: string }) => createElement(MockText, { testID: 'food-image-tile' }, name) };
});

const PHOTO = 'https://images.example.test/oat-crunch.jpg';
const shared = {
  id: '9c0ffee0-0000-4000-8000-0000000c0de5', name: 'Oat crunch bar', brand_or_restaurant: 'Madeup Mills',
  calories: 410, protein_g: 9, carbs_g: 62, fat_g: 14, serving_description: '100g', serving_size_grams: 100,
  nutrient_basis: 'PER_100G' as const, image_url: PHOTO,
};
const oldCopy = {
  id: '0ld0c0py-0000-4000-8000-000000000001', name: 'Granola cup', brand_or_restaurant: 'Madeup Mills',
  calories: 450, protein_g: 10, carbs_g: 60, fat_g: 18, serving_description: '100g', serving_size_grams: 100,
  nutrient_basis: 'PER_100G' as const, image_url: null,
};
const entry = (id: string, food: Record<string, unknown>) => ({
  id, food_item_id: food.id, meal_type: 'snack', quantity_multiplier: 0.4, original_quantity: 40, original_unit: 'g', food_item: food,
});
const getDaily = logApi.getDaily as jest.MockedFunction<typeof logApi.getDaily>;

async function browse() {
  getDaily.mockImplementation(async (date: string) => ({
    data: { entries: date === '2026-11-12' ? [entry('e1', oldCopy), entry('e2', shared)] : [] },
  }) as never);
  const hook = await renderHook(() => useFoodBrowse('member-off', '2026-11-12'));
  await act(async () => { await hook.result.current.loadBrowseFoods(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return hook.result.current;
}

const view = (over: Partial<React.ComponentProps<typeof FoodSearchView>>) => render(
  <FoodSearchView
    searchQuery="" onSearchChange={jest.fn()} onClearSearch={jest.fn()} onRetrySearch={jest.fn()}
    searching={false} showSlowMessage={false} searchError={null} searchResults={[]} didYouMean={[]}
    recentTab="recent" onRecentTabChange={jest.fn()} recentFoods={[]} frequentFoods={[]}
    onSelectFood={jest.fn()} onEnterManualMode={jest.fn()} {...over}
  />,
);
type HostNode = { type: string; props: Record<string, unknown>; children: Array<HostNode | string> | null };
/** The host Image elements in a rendered tree (RNTL 14 has no UNSAFE_ type queries). */
function imagesIn(tree: unknown): HostNode[] {
  const found: HostNode[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as HostNode;
    if (node.type === 'Image') found.push(node);
    (node.children ?? []).forEach(walk);
  };
  walk(tree);
  return found;
}
const photoUris = () => imagesIn(screen.toJSON()).map((i) => (i.props.source as { uri?: string })?.uri);

beforeEach(async () => {
  await AsyncStorage.clear();
  getDaily.mockReset();
});

describe('OFF-PHOTO-M case 10: Recent and Frequent after the log', () => {
  it.each(['recent', 'frequent'] as const)('%s draws the shared row photo; the old private copy draws the tile', async (tab) => {
    const lists = await browse();
    const list = tab === 'recent' ? lists.recentFoods : lists.frequentFoods;
    expect(list.map((f) => f.name)).toEqual(expect.arrayContaining(['Oat crunch bar', 'Granola cup']));
    expect(list.find((f) => f.name === 'Oat crunch bar')?.image_url).toBe(PHOTO);
    await view({ recentTab: tab, recentFoods: lists.recentFoods, frequentFoods: lists.frequentFoods });
    expect(photoUris()).toEqual([PHOTO]);
    expect(screen.getAllByTestId('food-image-tile').map((t) => (t.props.children as string))).toEqual(['Granola cup']);
  });
});

describe('OFF-PHOTO-M case 11: a search after the log', () => {
  it('the logged shared row comes first with its photo, and the live off_ row of the same food is dropped', async () => {
    const { recentFoods, frequentFoods } = await browse();
    const logged = matchLoggedFoods('oat crunch', recentFoods, frequentFoods);
    const catalog = [mapFoodItem({ ...shared, id: 'off_0000000012345' }), mapFoodItem({ ...shared, id: 'off_0000000099999', name: 'Oat crunch bites' })];
    const results = mergeWithLoggedMatches(logged, catalog);
    expect(results.map((f) => f.id)).toEqual([shared.id, 'off_0000000099999']);
    await view({ searchQuery: 'oat crunch', searchResults: results });
    expect(photoUris()).toEqual([PHOTO, PHOTO]);
    expect(screen.queryByTestId('food-image-tile')).toBeNull();
  });

  it("today's behaviour: an old private copy of the same name and brand still comes first, with no photo (OFF-COPIES-FOLD)", async () => {
    const { recentFoods, frequentFoods } = await browse();
    const logged = matchLoggedFoods('granola cup', recentFoods, frequentFoods);
    const live: SearchResult = mapFoodItem({ ...oldCopy, id: 'off_0000000054321', image_url: 'https://images.example.test/granola.jpg' });
    const results = mergeWithLoggedMatches(logged, [live]);
    expect(results.map((f) => f.id)).toEqual([oldCopy.id]);
    await view({ searchQuery: 'granola cup', searchResults: results });
    expect(imagesIn(screen.toJSON())).toHaveLength(0);
    expect(screen.getByTestId('food-image-tile')).toBeTruthy();
  });
});
