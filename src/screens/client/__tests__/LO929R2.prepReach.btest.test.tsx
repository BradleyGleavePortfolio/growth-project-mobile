// LO-929R2 B1 B-TEST (review only, never merge): the prep guide's summary and suggested prep days must scroll with
// the recipes. At 1c6235a2 they sit in the fixed masthead outside the ScrollView, so on a 320 pt phone at 130% text the
// list window is about 61 pt (render prep-week__w320__130, ctx#481) and on a 320 x 568 pt screen it is none: the recipes
// and ingredients cannot be reached. On main c26d4dab both blocks were inside the ScrollView. Fails at 1c6235a2.
import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { prepGuideApi } from '../../../services/api';
import PrepGuideScreen from '../PrepGuideScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../services/api', () => ({
  listsApi: { bulkAdd: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
}));

const recipe = {
  id: 'soup', title: 'Lentil soup with cumin and lemon', calories: 420, protein: 20, carbs: 50, fat: 10,
  prep_time_min: 10, cook_time_min: 20, servings: 2, tags: ['dinner'],
};

it('LO-929R2 B1: the prep guide summary and suggested prep days scroll with the recipes (reach at 320 pt and 130%)', async () => {
  jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue({ data: {
    week_start: '2026-11-02', source: 'plan', week_filter_applied: true, prep_day_suggestions: ['Sunday', 'Wednesday'],
    recipes: [recipe], aggregated_ingredients: [{ name: 'Red lentils', quantity: 400, unit: 'g', recipe_ids: ['soup'] }],
  } } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = await render(<QueryClientProvider client={client}><PrepGuideScreen /></QueryClientProvider>);
  await waitFor(() => expect(ui.getByText('Add all')).toBeTruthy());
  const scroll = within(ui.getByTestId('list-scroll'));
  expect(scroll.getByRole('button', { name: `Open ${recipe.title}` })).toBeTruthy();
  // What main scrolled must still scroll, so the masthead cannot fill a small screen above a pinned Add all.
  expect(scroll.getByText('1 recipe from your meal plan.')).toBeTruthy();
  expect(scroll.getByText('Suggested prep days')).toBeTruthy();
  expect(scroll.getByText('Choose the prep days that fit your week.')).toBeTruthy();
});
