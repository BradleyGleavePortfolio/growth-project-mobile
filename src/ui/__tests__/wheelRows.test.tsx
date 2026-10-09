/**
 * DS-PRIMITIVES-133 PR 2: the wheel band (B19) and the quiet list row.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockSelection = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: () => mockSelection(),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import { QuietRow, QuietSection, WheelBand, wheelFrameStyle, wheelValueStyle } from '..';
import { layout, lightTokens, wheel } from '../../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;

describe('WheelBand', () => {
  it('two hairlines behind the middle row, never a fill', async () => {
    const r = await render(<WheelBand testID="w" />);
    const band = flat(r.getByTestId('w'));
    expect(band).toMatchObject({
      position: 'absolute',
      top: wheel.rowHeight * 2,
      height: wheel.rowHeight,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: lightTokens.border,
      backgroundColor: 'transparent',
    });
    expect(r.getByTestId('w').props.pointerEvents).toBe('none');
  });

  it('the selected value is ink serif and larger than its neighbours', () => {
    const on = wheelValueStyle(0, lightTokens);
    const near = wheelValueStyle(1, lightTokens);
    const far = wheelValueStyle(-3, lightTokens);
    expect(on.color).toBe(lightTokens.textPrimary);
    expect(Number(on.fontSize)).toBeGreaterThan(Number(near.fontSize));
    expect(Number(near.fontSize)).toBeGreaterThan(Number(far.fontSize));
    expect(near.opacity).toBeGreaterThan(far.opacity as number);
  });

  it('the frame shows exactly five rows', () => {
    expect(wheelFrameStyle()).toEqual({ height: wheel.rowHeight * 5, overflow: 'hidden' });
  });
});

describe('QuietRow and QuietSection', () => {
  it('hairline row with a chevron when it navigates, selection haptic', async () => {
    const onPress = jest.fn();
    const r = await render(
      <QuietSection title="Account" testID="sec">
        <QuietRow label="Membership" value="Active" onPress={onPress} testID="row" />
      </QuietSection>,
    );
    expect(flat(r.getByTestId('sec'))).toMatchObject({
      borderTopColor: lightTokens.border,
      paddingVertical: layout.sectionPadY,
      marginBottom: layout.sectionGap,
    });
    expect(r.getByText('Account').props.accessibilityRole).toBe('header');
    expect(flat(r.getByTestId('row'))).toMatchObject({ minHeight: layout.rowMinHeight, borderBottomColor: lightTokens.border });
    expect(r.getByTestId('row').props.accessibilityLabel).toBe('Membership, Active');
    fireEvent.press(r.getByTestId('row'));
    expect(onPress).toHaveBeenCalled();
    expect(mockSelection).toHaveBeenCalled();
  });

  it('a row without onPress is plain text, no chevron, no button role', async () => {
    const r = await render(<QuietRow label="Plan" value="Foundations" testID="row" />);
    expect(r.getByTestId('row').props.accessibilityRole).toBeUndefined();
    expect(r.queryByRole('button')).toBeNull();
  });
});
