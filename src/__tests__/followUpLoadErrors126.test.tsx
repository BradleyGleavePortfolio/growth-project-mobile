import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InviteCodeRedeemersScreen from '../screens/coach/InviteCodeRedeemersScreen';
import RecipeDetailScreen from '../screens/client/RecipeDetailScreen';

const mockRedeemers = jest.fn();
const mockRecipe = jest.fn();
const mockBack = jest.fn();
jest.mock('../services/api', () => ({
  coachApi: { getInviteCodeRedeemers: (...args: unknown[]) => mockRedeemers(...args) },
  recipesApi: { getById: (...args: unknown[]) => mockRecipe(...args) },
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#123456' }), semanticColors: require('../theme/tokens').lightTokens }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockBack }),
  useRoute: () => ({ params: { recipeId: 'recipe-1' } }),
}));

beforeEach(() => jest.clearAllMocks());

const inviteProps = {
  route: { key: 'redeemers', name: 'InviteCodeRedeemers' as const, params: { inviteCodeId: 'invite-1', code: 'GP-CODE12' } },
  navigation: { goBack: mockBack, navigate: jest.fn() },
};

function recipeScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><RecipeDetailScreen /></QueryClientProvider>);
}

describe('FU-COPY-126 invite history', () => {
  it('a missing invite does not claim the live route is coming soon', async () => {
    mockRedeemers.mockRejectedValue({ response: { status: 404 } });
    const ui = await render(<InviteCodeRedeemersScreen {...inviteProps} />);
    expect(await ui.findByText('Invite code unavailable')).toBeTruthy();
    expect(ui.queryByText(/coming soon|isn't live yet/)).toBeNull();
    expect(ui.getByText('Who joined')).toBeTruthy();
  });

  it('history failures offer a safe retry and then show the empty state', async () => {
    mockRedeemers.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    mockRedeemers.mockResolvedValueOnce({ data: { redeemers: [] } });
    const ui = await render(<InviteCodeRedeemersScreen {...inviteProps} />);
    expect(await ui.findByText(/Could not load who joined/)).toBeTruthy();
    expect(ui.queryByText(/Request failed/)).toBeNull();
    await fireEvent.press(ui.getByRole('button', { name: 'Retry' }));
    expect(await ui.findByText('No clients joined yet')).toBeTruthy();
  });
});

describe('FU-COPY-126 recipe detail', () => {
  it.each([new Error('Network Error'), { response: { status: 500 } }])(
    'a load failure is not labelled as a missing recipe and can be retried',
    async (failure) => {
      mockRecipe.mockRejectedValue(failure);
      const ui = await recipeScreen();
      expect(await ui.findByText('Could not load this recipe. Check your connection and try again.')).toBeTruthy();
      expect(ui.queryByText('Recipe not found.')).toBeNull();
      await fireEvent.press(ui.getByRole('button', { name: 'Retry recipe' }));
      expect(mockRecipe).toHaveBeenCalledTimes(2);
    },
  );

  it('an actual 404 still says the recipe is unavailable, without a retry loop', async () => {
    mockRecipe.mockRejectedValue({ response: { status: 404 } });
    const ui = await recipeScreen();
    expect(await ui.findByText('This recipe is no longer available.')).toBeTruthy();
    expect(ui.queryByRole('button', { name: 'Retry recipe' })).toBeNull();
  });
});
