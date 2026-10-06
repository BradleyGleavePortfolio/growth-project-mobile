import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import HapticPressable from '../HapticPressable';

jest.mock('../../screens/client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

describe('shared press controls — screen-reader semantics', () => {
  it('exposes an actionable control as a button and keeps its handler', async () => {
    const onPress = jest.fn();
    const view = await render(
      <HapticPressable onPress={onPress}><Text>Save changes</Text></HapticPressable>,
    );
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes a long-press-only control as a button', async () => {
    const view = await render(
      <HapticPressable onLongPress={jest.fn()}><Text>More options</Text></HapticPressable>,
    );
    expect(view.getByRole('button', { name: 'More options' })).toBeTruthy();
  });

  it('keeps explicit roles, labels and selected state', async () => {
    const view = await render(
      <HapticPressable
        onPress={jest.fn()}
        accessibilityRole="radio"
        accessibilityLabel="Dark appearance"
        accessibilityState={{ selected: true }}
      ><Text>Dark</Text></HapticPressable>,
    );
    expect(view.getByRole('radio', { name: 'Dark appearance', selected: true })).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('does not announce non-actionable content as a button', async () => {
    const view = await render(<HapticPressable><Text>Summary</Text></HapticPressable>);
    expect(view.queryByRole('button')).toBeNull();
  });

  it('keeps disabled controls non-interactive', async () => {
    const onPress = jest.fn();
    const view = await render(
      <HapticPressable disabled onPress={onPress}><Text>Saving</Text></HapticPressable>,
    );
    const button = view.getByRole('button', { name: 'Saving', disabled: true });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
