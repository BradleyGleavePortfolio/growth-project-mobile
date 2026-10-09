/**
 * DS-THEME-133 (QA-THEME-128 rows): one hairline colour, rounded legacy radius
 * keys, and the Settings "Haptics" switch honoured by every haptic path.
 */
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockImpact = jest.fn((_s: string) => Promise.resolve());
const mockNotification = jest.fn((_t: string) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (s: string) => mockImpact(s),
  notificationAsync: (t: string) => mockNotification(t),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import HapticPressable from '../../components/HapticPressable';
import { lightTap, mediumTap, successTap, warningTap } from '../../utils/haptics';
import { setHapticsEnabled } from '../../ui/haptics/haptics.service';
import { useTheme } from '../ThemeProvider';
import { Radius } from '../index';
import { Radius as ConstantsRadius } from '../../constants/theme';
import { lightTokens, radius } from '../tokens';

beforeEach(() => {
  mockImpact.mockClear();
  mockNotification.mockClear();
  setHapticsEnabled(true);
});

describe('one hairline colour', () => {
  it('useTheme().colors.border and divider are the semantic grey', async () => {
    let seen: { border?: string; divider?: string } = {};
    function Probe() {
      const { colors } = useTheme();
      seen = { border: colors.border, divider: colors.divider };
      return <Text>probe</Text>;
    }
    await render(<Probe />);
    expect(seen).toEqual({ border: lightTokens.border, divider: lightTokens.border });
  });
});

describe('rounded corners everywhere (owner 17:07)', () => {
  it('legacy keys in all three radius sets resolve to the rounded scale', () => {
    for (const set of [radius, Radius, ConstantsRadius] as Array<Record<string, number>>) {
      expect(set.sm).toBe(radius.button);
      expect(set.md).toBe(radius.input);
      expect(set.lg).toBe(radius.card);
      expect(set.sm).toBeGreaterThanOrEqual(12);
    }
    expect(radius['2xl']).toBe(radius.sheet);
  });
});

describe('the Haptics switch', () => {
  it('HapticPressable and utils/haptics buzz when it is on', async () => {
    const r = await render(<HapticPressable onPress={jest.fn()} testID="p"><Text>Go</Text></HapticPressable>);
    fireEvent.press(r.getByTestId('p'));
    lightTap();
    mediumTap();
    successTap();
    warningTap();
    expect(mockImpact.mock.calls.map((c) => c[0])).toEqual(['light', 'light', 'medium']);
    expect(mockNotification.mock.calls.map((c) => c[0])).toEqual(['success', 'warning']);
  });

  it('nothing buzzes when it is off', async () => {
    setHapticsEnabled(false);
    const r = await render(<HapticPressable intent="heavy" onPress={jest.fn()} testID="p"><Text>Go</Text></HapticPressable>);
    fireEvent.press(r.getByTestId('p'));
    lightTap();
    successTap();
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();
  });
});
