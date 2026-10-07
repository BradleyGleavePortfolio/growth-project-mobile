import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { lightTokens, colors } from '../../theme/tokens';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../config/featureFlags', () => ({
  featureFlags: { clientCalendar: true, communityTab: true },
}));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens }),
}));
jest.mock('../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client' }) }));
jest.mock('../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../components/community/UnreadBadge', () => () => null);
jest.mock('../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (screen: unknown) => screen }));
jest.mock('../../entitlements/dunning/UpdateCardScreen', () => () => null);
jest.mock('../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, color }: { name: string; color: string }) =>
    require('react').createElement(require('react-native').Text, { testID: name, style: { color } }, name),
}));

// Shallow only leaf screens; keep the real tab/stack routers and their registrations.
const navSource = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  jest.doMock(`../${modulePath}`, () => ({
    __esModule: true, default: () => <Text testID="destination">{modulePath}</Text>,
  }));
}
jest.doMock('../CommunityNavigator', () => ({
  __esModule: true, default: () => <Text testID="destination">CommunityNavigator</Text>,
}));
const ClientNavigator = require('../ClientNavigator').default;

it('keeps six labelled outline tabs and their original stack destinations', async () => {
  const view = await render(<NavigationContainer><ClientNavigator /></NavigationContainer>);
  const tabs = [
    ['Home', 'Home', 'home-outline', '../screens/client/HomeScreen'],
    ['Train', 'Train', 'fitness-outline', '../screens/client/WorkoutScreen'],
    ['Food', 'Log food', 'restaurant-outline', '../screens/client/LogScreen'],
    ['Calendar', 'Calendar', 'calendar-outline', '../screens/client/calendar/CalendarHomeScreen'],
    ['You', 'Profile and more', 'person-outline', '../screens/client/MoreScreen'],
    ['Community', 'Community', 'chatbubbles-outline', 'CommunityNavigator'],
  ];
  for (const [label, accessibility, icon, destination] of tabs) {
    expect(view.getByText(label)).toBeTruthy();
    await fireEvent.press(view.getByLabelText(accessibility));
    expect(await view.findByText(destination)).toBeTruthy();
    expect(view.getAllByTestId(icon).some((glyph) => glyph.props.style.color === colors.forest)).toBe(true);
    expect(StyleSheet.flatten(view.getByText(label).props.style)).toMatchObject({
      fontFamily: 'Inter_500Medium', fontSize: 11, fontWeight: '500',
    });
  }
  const inactive = view.getByText('Home');
  expect(StyleSheet.flatten(inactive.props.style)).toMatchObject({ color: lightTokens.textMuted });
});
