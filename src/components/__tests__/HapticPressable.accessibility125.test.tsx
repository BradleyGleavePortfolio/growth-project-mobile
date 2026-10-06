import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import HapticPressable from '../HapticPressable';

jest.mock('../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined), ImpactFeedbackStyle: { Light: 'light' },
}));

describe('shared press controls — screen-reader semantics', () => {
  it('exposes an actionable control as a button and keeps its handler', async () => {
    const onPress = jest.fn();
    const view = await render(<HapticPressable onPress={onPress}><Text>Save changes</Text></HapticPressable>);
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit roles, labels and selected state', async () => {
    const view = await render(
      <HapticPressable onPress={jest.fn()} accessibilityRole="radio" accessibilityLabel="Dark appearance"
        accessibilityState={{ selected: true }}><Text>Dark</Text></HapticPressable>,
    );
    expect(view.getByRole('radio', { name: 'Dark appearance', selected: true })).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('does not announce non-actionable content as a button', async () => {
    const view = await render(<HapticPressable><Text>Summary</Text></HapticPressable>);
    expect(view.queryByRole('button')).toBeNull();
  });
});
