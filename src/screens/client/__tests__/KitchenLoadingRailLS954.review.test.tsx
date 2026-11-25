import React from 'react';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecipesScreen from '../RecipesScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client', profile: { diet_restrictions: [] } }),
}));
jest.mock('../../../lib/recipeAllergens', () => ({
  ...jest.requireActual('../../../lib/recipeAllergens'),
  useRecipeAllergenGuide: () => ({ hiddenNames: [], settled: true }),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/api', () => ({
  recipesApi: { list: () => new Promise(() => undefined), listSaved: async () => ({ data: [] }) },
  profileApi: { update: jest.fn() },
}));

type Ancestor = { type: unknown; props: { horizontal?: boolean; style?: StyleProp<ViewStyle> }; parent: Ancestor | null };

// Native RN ScrollView's baseHorizontal sets flexGrow:1 and flexShrink:1.
// The loading branch is a non-scrolling sibling: a maxHeight alone cannot
// reserve the 44pt controls when its skeleton consumes the remaining height.
// This is a reservation regression guard, not native-device measurement.
it('B2: Recipes reserves its 44pt filter rail while loading at 320pt and 130% text', async () => {
  const spy = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 320, height: 568, scale: 1, fontScale: 1.3 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = await render(<QueryClientProvider client={client}><RecipesScreen /></QueryClientProvider>);
  try {
    expect(ui.getByText('Loading recipes…')).toBeTruthy();
    let rail = ui.getByRole('button', { name: 'All' }) as unknown as Ancestor | null;
    while (rail && !(rail.type === 'RCTScrollView' && rail.props.horizontal)) rail = rail.parent;
    expect(rail).not.toBeNull();
    const style = StyleSheet.flatten(rail!.props.style) ?? {};
    // Either a real minimum height or disabling native flex shrink reserves
    // this maxHeight:44 rail; currently neither protection is present.
    expect(style.flexShrink === 0 || (typeof style.minHeight === 'number' && style.minHeight >= 44)).toBe(true);
  } finally {
    await ui.unmount();
    client.clear();
    spy.mockRestore();
  }
});
