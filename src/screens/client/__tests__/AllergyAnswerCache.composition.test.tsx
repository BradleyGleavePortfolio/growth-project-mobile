import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// B-569-SOL-M-131-1 (ALLERGY-FIN-132): the Recipes allergy sheet and Edit Profile show one saved answer. The real user
// cache (lib/userCache over the AsyncStorage jest mock) and the real useCurrentUser connect the two screens; only the
// network, navigation, theme, analytics, crash reporting and haptics are stubbed.
const mockUpdate = jest.fn(async (_body: unknown) => ({}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => 'legacy' }) }),
}));
jest.mock('../../../services/api', () => ({
  recipesApi: {
    list: async () => ({ data: [] }), listSaved: async () => ({ data: [] }),
    allergens: async () => ({ data: { allergens: [{ code: 'fish', label: 'fish' }, { code: 'soy', label: 'soy' }], your_allergens: [] } }),
  },
  profileApi: { update: (body: unknown) => mockUpdate(body) },
}));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { warning: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('../../../components/HapticPressable', () => {
  const React = require('react'), { View } = require('react-native');
  return { __esModule: true, default: ({ intent, ...props }: import('../../../components/HapticPressable').HapticPressableProps) =>
    React.createElement(View, { ...props, onPress: props.disabled ? undefined : props.onPress }) };
});
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import RecipesScreen from '../RecipesScreen';
import EditProfileScreen from '../EditProfileScreen';

const client = { id: 'client', email: 'client@example.test', role: 'client', profile: { current_weight: 180 } };

beforeEach(async () => {
  await AsyncStorage.clear();
  // Signed in with no allergy answer yet: the user cache holds the account, a legacy writer left the old key, and the
  // lean flow is done, so Recipes opens the allergy sheet once.
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify(client));
  await AsyncStorage.setItem('user_data', JSON.stringify(client));
  await AsyncStorage.setItem('lean_onboarding_done', 'true');
});

it('keeps a Fish answer saved on the Recipes sheet when Edit Profile then adds Soy', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const recipes = await render(<QueryClientProvider client={queryClient}><RecipesScreen /></QueryClientProvider>);
  const fishOnSheet = await recipes.findByRole('button', { name: 'Fish' });
  await act(async () => { fireEvent.press(fishOnSheet); });
  await waitFor(() => expect(recipes.getByRole('button', { name: 'Fish' }).props.accessibilityState.selected).toBe(true));
  await act(async () => { fireEvent.press(recipes.getByRole('button', { name: 'Save restrictions' })); });
  expect(mockUpdate).toHaveBeenCalledWith({ diet_restrictions: ['Fish'] });
  await waitFor(async () => expect(await AsyncStorage.getItem('allergy_prompt_shown')).toBe('true'));
  const cached = JSON.parse((await AsyncStorage.getItem('prefs:auth.user_data')) ?? '{}');
  expect(cached.profile).toEqual({ current_weight: 180, diet_restrictions: ['Fish'] });
  await recipes.unmount();

  mockUpdate.mockClear();
  await render(<EditProfileScreen />);
  await waitFor(() => expect(screen.getByLabelText('Current weight in pounds').props.value).toBe('180'));
  expect(screen.getByLabelText('Fish').props.accessibilityState.selected).toBe(true);
  await act(async () => { fireEvent.press(screen.getByLabelText('Soy')); });
  await waitFor(() => expect(screen.getByLabelText('Soy').props.accessibilityState.selected).toBe(true));
  await act(async () => { fireEvent.press(screen.getByLabelText('Save profile')); });
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ diet_restrictions: ['Fish', 'Soy'] }));
});
