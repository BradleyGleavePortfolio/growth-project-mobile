import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { lightTokens, colors, typography } from '../../theme/tokens';

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
    const text = view.getByText(label);
    expect(StyleSheet.flatten(text.props.style)).toMatchObject({ ...typography.tabLabelActive });
    // B26: one line, shrinking instead of wrapping ("Communi / ty" on a 360 pt Android phone).
    expect(text.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
    // SHOTS-134B 3: the label reaches over the tab button's 5 pt padding.
    expect(StyleSheet.flatten(text.props.style)).toMatchObject({ marginHorizontal: -5, textAlign: 'center' });
  }
  const inactive = view.getByText('Home');
  expect(StyleSheet.flatten(inactive.props.style)).toMatchObject({ ...typography.tabLabel, color: lightTokens.textMuted });
});

it('fits "Community" inside one of six tabs on a 360 pt wide phone (B26)', () => {
  // Advance width of "Community" measured from @expo-google-fonts/inter 0.4
  // Inter_500Medium.ttf (hmtx / unitsPerEm): 5.484 em; Regular is 5.396 em.
  const COMMUNITY_EM = 5.484;
  const t = typography.tabLabelActive;
  const width = COMMUNITY_EM * t.fontSize + t.letterSpacing * 'Community'.length;
  // The tab item keeps no side padding, and the label reaches back over the
  // tab button's own padding (read from the installed bottom-tabs), so the
  // whole 60 pt is the label's even where text cannot shrink (SHOTS-134B 3).
  expect(navSource).toContain('tabBarItemStyle: { paddingHorizontal: 0 }');
  const item = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'node_modules',
    '@react-navigation', 'bottom-tabs', 'src', 'views', 'BottomTabItem.tsx'), 'utf8');
  const pad = Number(/tabVerticalUiKit: \{[^}]*?padding: (\d+)/.exec(item)?.[1]);
  expect(navSource).toContain(`const TAB_BUTTON_PADDING = ${pad};`);
  expect(navSource).toContain('marginHorizontal: -TAB_BUTTON_PADDING');
  expect(width).toBeLessThanOrEqual(360 / 6);
  // Without reaching over the padding the label had 50 pt and clipped.
  expect(width).toBeGreaterThan(360 / 6 - 2 * pad);
});
