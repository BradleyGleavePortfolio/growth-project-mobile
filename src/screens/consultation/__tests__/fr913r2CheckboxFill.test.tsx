/**
 * FR-913R2 class-first (LS-E4R2 B1): the shared consultation Checkbox fills
 * forest only for a ticked default row (the P0 agreement); the coach sign-up
 * card (tan) and an unticked row keep their look; the tick still toggles.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { Checkbox } from '../components';
import { colors, lightTokens } from '../../../theme/tokens';

type Row = [string, 'default' | 'tan', boolean, string];
const rows: Row[] = [
  ['default, ticked', 'default', true, colors.forest],
  ['default, unticked', 'default', false, lightTokens.bgPrimary],
  ['tan (coach sign-up), ticked', 'tan', true, colors.cream],
  ['tan (coach sign-up), unticked', 'tan', false, colors.cream],
];

it.each(rows)('%s', async (_name, variant, checked, bg) => {
  const onToggle = jest.fn();
  const r = await render(<Checkbox variant={variant} checked={checked} onToggle={onToggle} label="Box" testID="box" />);
  const row = r.getByTestId('box');
  expect(StyleSheet.flatten(row.props.style).backgroundColor).toBe(bg);
  expect(row.props.accessibilityState.checked).toBe(checked);
  await fireEvent.press(row);
  expect(onToggle).toHaveBeenCalledTimes(1);
});
