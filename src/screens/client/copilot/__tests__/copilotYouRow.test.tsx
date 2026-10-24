/** F12 (Path Copilot style A frame 01, CP-A-01/02): "Your path" leads Your plan on You when the Copilot route is built. */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: jest.fn() }) }) }));
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: new Proxy({}, { get: (_t, k: string) => mockFlags[k] ?? false }) }));
jest.mock('../../../../config/healthConnect', () => ({ isAndroidHealthConnectEnabled: () => false }));
jest.mock('../../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../../theme/tokens').lightTokens }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../../components/tutorial/TutorialTarget', () => ({ children }: { children: unknown }) => children);
jest.mock('../../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import MoreScreen, { COPILOT_MORE_ITEM, planMoreItems } from '../../MoreScreen';

afterEach(() => { mockFlags.clientPathCopilot = false; mockNavigate.mockReset(); });

test('with the Copilot flag on, Your path is the first Your plan row and opens Copilot', async () => {
  mockFlags.clientPathCopilot = true;
  expect(planMoreItems()[0]).toBe(COPILOT_MORE_ITEM);
  expect(COPILOT_MORE_ITEM).toMatchObject({ label: 'Your path', description: 'Ask why your plan is set the way it is', section: 'Your plan' });
  const s = await render(<MoreScreen />);
  await fireEvent.press(s.getByText('Your path'));
  expect(mockNavigate).toHaveBeenCalledWith('Copilot');
});

test('with the flag off there is no row into an unregistered route', () => {
  expect(planMoreItems()).not.toContain(COPILOT_MORE_ITEM);
});

// Sol B-G1 (#878 round 1): Your path is style A's new row (.lrow.new), the other rows stay as they are.
test('Your path is the leaf-tint new row with the forest icon tile; the next row is unchanged', async () => {
  mockFlags.clientPathCopilot = true;
  const s = await render(<MoreScreen />);
  const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
  expect(flat(s.getByLabelText('Your path'))).toMatchObject({ backgroundColor: '#EEF4E0', minHeight: 62, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 16 });
  expect(flat(s.getByTestId('more-row-new-icon'))).toMatchObject({ width: 36, height: 36, borderRadius: 12, backgroundColor: '#1C3023' });
  expect(flat(s.getByText('Your path'))).toMatchObject({ fontSize: 16, fontWeight: '500' });
  expect(flat(s.getByText('Ask why your plan is set the way it is'))).toMatchObject({ fontSize: 13.5, color: '#5A5A56' });
  expect(s.getAllByTestId('more-row-new-icon')).toHaveLength(1);
});
