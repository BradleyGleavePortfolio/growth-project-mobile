// FIX-929R3 (LS-929R2 B1, LO-929R2 C2): one table per class across the kitchen screens.
//  (b) the masthead progress strip stays inside the 272 pt masthead at 320 pt for any list size;
//  (c) a kcal figure is grouped the way the app shows kcal elsewhere ("1,234", copilot/pathChangeWords.ts kcalText).
// The prep and recipe detail kcal are asserted in KitchenStyleC130; the prep reach in LO929R2.prepReach.btest.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyleCDashes } from '../../../ui/layout/StyleCPage';
import { layout } from '../../../theme/tokens';

const chili = { id: 'r1', title: 'Big batch chili', tags: [], calories: 1234, protein: 56, carbs: 140, fat: 38, prep_time_min: 15, cook_time_min: 45, servings: 4, ingredients: ['Beans'], instructions: ['Simmer.'], is_public: true, created_by_id: 'coach', _count: { saved_by: 0 } };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => 'legacy' }) }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: [] } }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/api', () => ({
  recipesApi: { list: async () => ({ data: [chili] }), listSaved: async () => ({ data: [] }), save: async () => ({}), unsave: async () => ({}) },
  profileApi: { update: jest.fn(async () => ({})) },
}));
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import RecipesScreen from '../RecipesScreen';

const flat = (style: unknown) => StyleSheet.flatten(style as never) ?? {};
const MASTHEAD_AT_320 = 320 - 2 * layout.gutter;

describe.each([11, 12, 20])('the progress strip with %i items', (total) => {
  it('can shrink to the masthead and keeps every dash visible', async () => {
    await render(<StyleCDashes total={total} done={Math.floor(total / 2)} label={`${total} to get.`} />);
    const row = screen.root!.children.find((node) => typeof node !== 'string' && node.props.accessibilityElementsHidden === true);
    if (!row || typeof row === 'string') throw new Error('No dash strip rendered');
    const rowStyle = flat(row.props.style);
    const dashes = row.children.filter((node): node is Exclude<typeof node, string> => typeof node !== 'string');
    const n = Math.min(total, 12);
    expect(dashes).toHaveLength(n);
    expect(rowStyle.flexWrap === 'wrap' || ((rowStyle.flexShrink ?? 0) > 0 && rowStyle.minWidth === 0)).toBe(true);
    for (const dash of dashes) expect(flat(dash.props.style).flexShrink ?? 0).toBeGreaterThan(0);
    // Shrunk evenly to the 272 pt masthead, a dash stays a visible stroke.
    const gap = Number(rowStyle.gap ?? 0);
    const width = Number(flat(dashes[0].props.style).width);
    const shrunk = Math.min(width, (MASTHEAD_AT_320 - gap * (n - 1)) / n);
    expect(shrunk).toBeGreaterThanOrEqual(12);
  });
});

it('Recipes groups a four-digit kcal as the app does elsewhere', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = await render(<QueryClientProvider client={client}><RecipesScreen /></QueryClientProvider>);
  await waitFor(() => expect(ui.getByText(/1,234 kcal/)).toBeTruthy());
  expect(ui.queryByText(/1234 kcal/)).toBeNull();
  client.clear();
});
