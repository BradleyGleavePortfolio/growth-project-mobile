/**
 * LS-PLAN-SWAPS-COACH-M-1 B1 (B-TEST, never merge alone): the meal page's Options for clients and Recipe card draw
 * their rows at the GOAL frame's measured type (frames/S1_F01_390_100.png on ctx#613 @ f1f401ad, 2 px = 1 pt):
 * an option's name is Inter Medium 16 (typography.bodyMd, 433 px for "Rice cakes, honey and whey"), its macro line
 * Inter 14 (typography.bodySmall, 348 px for "240 kcal · P 26 · C 30 · F 2"), the block's line Inter 14 (512 px for
 * "this meal in every day plan that uses it."), the recipe's "Per serving" line Inter 14 (518 px). At bbbb58c0 every
 * one of them is typography.body (Inter Regular 16), so the Recipe card leaves the first screen at 390 pt (F01, F07).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useRoute: () => ({}),
  useFocusEffect: jest.fn(), usePreventRemove: jest.fn() }));

import { OptionsBlock, RecipeCard } from '../MealEditorBlocks';
import { typography } from '../../../../theme/tokens';

const meal = (id: string, name: string, k: number, p: number, c: number, f: number) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: k, protein_g: p, carbs_g: c, fats_g: f, archived_at: null,
    items: null, created_at: '2026-11-01T00:00:00.000Z', swap_template_ids: [], recipe_id: null }) as any;
const type = (el: { props: { style?: unknown } }) => {
  const s = StyleSheet.flatten(el.props.style as any) ?? {};
  return { fontFamily: s.fontFamily, fontSize: s.fontSize };
};
const small = { fontFamily: typography.bodySmall.fontFamily, fontSize: typography.bodySmall.fontSize };
const medium = { fontFamily: typography.bodyMd.fontFamily, fontSize: typography.bodyMd.fontSize };

it('B1: the Options for clients line, an option\'s name and its macro line are drawn at the F01 frame\'s measured type', async () => {
  const rows = [{ id: 'm2', state: 'meal' as const, meal: meal('m2', 'Rice cakes, honey and whey', 240, 26, 30, 2) }];
  const o = await render(<OptionsBlock rows={rows} editing={false} onEditing={() => {}} onAdd={() => {}} onChange={() => {}} />);
  expect({
    line: type(o.getByText('Clients can pick one instead. These go with this meal in every day plan that uses it.')),
    name: type(o.getByText('Rice cakes, honey and whey')),
    macros: type(o.getByText('240 kcal · P 26 · C 30 · F 2')),
  }).toEqual({ line: small, name: medium, macros: small });
});

it('B1: the Recipe card\'s per-serving and share lines are drawn at the F01 frame\'s measured type (Inter 14)', async () => {
  const recipe = { id: 'r1', title: 'Banana protein shake', calories: 250, protein: 25, carbs: 32, fat: 3, is_public: true,
    created_by_id: 'coach', allergens: ['dairy'], allergens_declared: true };
  const r = await render(<RecipeCard recipeId="r1" mine={[recipe]} error={null} retry={() => {}} retrying={false} onPick={() => {}} onRemove={() => {}} />);
  expect({
    perServing: type(r.getByText('Per serving · 250 kcal · P 25 · C 32 · F 3')),
    share: type(r.getByText('Shared with your clients')),
  }).toEqual({ perServing: small, share: small });
});
