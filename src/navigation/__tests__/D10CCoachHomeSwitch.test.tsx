/**
 * D10-BUILD-COMMUNITY S1 (R1, the switch): the coach Community stack's first page is the S v2 Home with
 * featureFlags.communityHomeV2 or communitySpaceChat on (the client tab's own rule, CommunityNavigator.tsx:83), with
 * no stack bar, and New space is registered beside it; with both off it is today's K2 page with today's options
 * (title 'Community', the bone bar, Back with coachTabsV2) and New space is not registered.
 *
 * The real CoachCommunityNavigator in a NavigationContainer; every screen it imports is a labelled leaf (read from its
 * own import lines, as pushTapStack.test.tsx does), so a page added later is a leaf too.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render } from '@testing-library/react-native';

const mockFlags: Record<string, boolean> = {};
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => '#000000' }) }),
  LightTheme: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../components/community/CommunityTermsGate', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const source = fs.readFileSync(path.join(__dirname, '..', 'CoachCommunityNavigator.tsx'), 'utf8');
for (const match of source.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  const label = modulePath.split('/').pop() as string;
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: () => <Text>{label}</Text> }));
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CoachCommunityNavigator = require('../CoachCommunityNavigator').default;

const Root = createNativeStackNavigator();
const ref = createNavigationContainerRef<ParamListBase>();

async function mount(flags: Record<string, boolean>) {
  for (const k of Object.keys(mockFlags)) delete mockFlags[k];
  Object.assign(mockFlags, { coachCommunity: true, communityEvents: true, communityDm: true, coachTabsV2: true }, flags);
  const view = await render(
    <NavigationContainer ref={ref}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="CommunityStack" component={CoachCommunityNavigator} />
      </Root.Navigator>
    </NavigationContainer>,
  );
  const stack = ref.getRootState().routes[0].state as { routeNames: string[]; routes: { name: string }[] };
  return { view, stack, options: ref.getCurrentOptions() as Record<string, unknown> };
}

describe('S1: the coach Community stack\'s first page follows R1', () => {
  it.each([
    ['communityHomeV2 on', { communityHomeV2: true, communitySpaceChat: false }],
    ['communitySpaceChat on', { communityHomeV2: false, communitySpaceChat: true }],
    ['both on', { communityHomeV2: true, communitySpaceChat: true }],
  ])('%s: the S v2 Home, no stack bar, and New space registered', async (_label, flags) => {
    const { view, stack, options } = await mount(flags);
    expect(stack.routes[0].name).toBe('CoachCommunityHome');
    expect(view.getByText('CoachSpacesHomeScreen')).toBeTruthy();
    expect(view.queryByText('CoachCommunityHomeScreen')).toBeNull();
    expect(options.headerShown).toBe(false);
    expect(stack.routeNames).toContain('CoachCommunityNewSpace');
    await act(async () => { ref.navigate('CommunityStack', { screen: 'CoachCommunityNewSpace' }); });
    expect(ref.getCurrentRoute()?.name).toBe('CoachCommunityNewSpace');
    expect((ref.getCurrentOptions() as Record<string, unknown>).headerShown).toBe(false);
  });

  it.each([true, false])('both off (coachTabsV2 %s): today\'s K2 page with today\'s options; no New space', async (tabsV2) => {
    const { view, stack, options } = await mount({ communityHomeV2: false, communitySpaceChat: false, coachTabsV2: tabsV2 });
    expect(view.getByText('CoachCommunityHomeScreen')).toBeTruthy();
    expect(view.queryByText('CoachSpacesHomeScreen')).toBeNull();
    expect(stack.routeNames).not.toContain('CoachCommunityNewSpace');
    expect(options).toEqual(expect.objectContaining({
      headerShown: true, title: 'Community', headerTitle: '', headerShadowVisible: false,
      headerStyle: { backgroundColor: jest.requireActual('../../theme/tokens').colors.bone },
    }));
    if (!tabsV2) {
      expect(options.headerLeft).toBeUndefined();
      return;
    }
    const back = await render(<>{(options.headerLeft as () => React.ReactElement)()}</>);
    expect(back.getByTestId('community-back').props.accessibilityLabel).toBe('Back');
  });
});
