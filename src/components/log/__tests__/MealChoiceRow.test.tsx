// MEAL-CHOICE-ROW (owner #UI-3d, "as your add-food design draws"): the one meal choice for the search sheet and the edit
// sheet. Four equal segments in one row at default text; two rows of two at 130% text or when the longest name does not
// fit a quarter of the track; never three and one. Layout is driven by the measured track and longest name.
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import MealChoiceRow from '../MealChoiceRow';
import { colors as palette, layout, lightTokens, radius } from '../../../theme/tokens';
import type { MealType } from '../../../types';

let mockScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockScale }),
}));

type Flat = TextStyle & ViewStyle;
const flat = (node: { props: { style?: unknown } }): Flat => StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {};
const NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

// 390 pt phone: 342 pt track; 360 pt phone: 312 pt track. "Breakfast" in Inter Medium 13 is 59.3 pt wide at 100% (68.1 at
// 115%), from the font's own advance widths.
const show = async ({ track = 342, longest = 59.3, value = 'lunch' as MealType, onChange = jest.fn(), disabled = false } = {}) => {
  await render(<MealChoiceRow testID="meals" value={value} onChange={onChange} disabled={disabled} />);
  await fireEvent(screen.getByTestId('meals'), 'layout', { nativeEvent: { layout: { width: track, height: 50 } } });
  await fireEvent(screen.getByTestId('meal-choice-measure', { includeHiddenElements: true }), 'layout',
    { nativeEvent: { layout: { width: longest, height: 16 } } });
  return onChange;
};
const lines = () => within(screen.getByTestId('meals')).getAllByTestId('meal-choice-line')
  .map((line) => within(line).getAllByRole('radio').map((r) => r.props.accessibilityLabel));

beforeEach(() => { mockScale = 1; });

it.each([[342], [312]])('draws one row of four equal segments at default text on a %i pt track', async (track) => {
  await show({ track });
  expect(lines()).toEqual([NAMES]);
  const line = within(screen.getByTestId('meals')).getByTestId('meal-choice-line');
  expect(flat(line)).toMatchObject({ flexDirection: 'row' });
  expect(flat(line).flexWrap).toBeUndefined();
  for (const seg of within(line).getAllByRole('radio')) expect(flat(seg)).toMatchObject({ flex: 1, minWidth: 0 });
});

it('stacks two rows of two at 130% text, even when one row would fit', async () => {
  mockScale = 1.3;
  await show({ track: 342, longest: 40 });
  expect(lines()).toEqual([['Breakfast', 'Lunch'], ['Dinner', 'Snacks']]);
});

it.each([
  ['115% text on a 360 pt phone', 1.15, 312, 68.1],
  ['default text on a 320 pt phone', 1, 272, 59.3],
])('stacks two rows of two, never three and one, when the longest name does not fit: %s', async (_case, scale, track, longest) => {
  mockScale = scale;
  await show({ track, longest });
  expect(lines()).toEqual([['Breakfast', 'Lunch'], ['Dinner', 'Snacks']]);
});

it('keeps one row at 115% text on a 390 pt phone, where it still fits', async () => {
  mockScale = 1.15;
  await show({ track: 342, longest: 68.1 });
  expect(lines()).toEqual([NAMES]);
});

it('is one single choice: four radios in order, the chosen one checked, only the existing names', async () => {
  await show({ value: 'dinner' });
  const radios = within(screen.getByTestId('meals')).getAllByRole('radio');
  expect(screen.getByTestId('meals').props.accessibilityRole).toBe('radiogroup');
  expect(radios.map((r) => r.props.accessibilityLabel)).toEqual(NAMES);
  expect(radios.map((r) => !!r.props.accessibilityState?.checked)).toEqual([false, false, true, false]);
  expect(within(screen.getByTestId('meals')).getAllByText(/./).map((t) => t.props.children)).toEqual(NAMES);
});

it('draws the board: a cream track, 44 pt segments, the chosen one on the surface with a hairline', async () => {
  await show({ value: 'lunch' });
  expect(flat(screen.getByTestId('meals'))).toMatchObject({ backgroundColor: palette.cream, borderRadius: radius.input });
  const on = within(screen.getByTestId('meals')).getByLabelText('Lunch');
  const off = within(screen.getByTestId('meals')).getByLabelText('Dinner');
  expect(flat(on)).toMatchObject({ minHeight: layout.touchMin, backgroundColor: lightTokens.bgSurface, borderColor: lightTokens.border });
  expect(flat(off)).toMatchObject({ minHeight: layout.touchMin, borderColor: 'transparent' });
  expect(flat(off).backgroundColor).toBeUndefined();
  expect(flat(within(on).getByText('Lunch'))).toMatchObject({ color: lightTokens.textPrimary });
  expect(flat(within(off).getByText('Dinner'))).toMatchObject({ color: lightTokens.textMuted });
});

it('reports the tapped meal', async () => {
  const onChange = await show();
  await fireEvent.press(within(screen.getByTestId('meals')).getByLabelText('Snacks'));
  expect(onChange).toHaveBeenCalledWith('snack');
});

it('does nothing while locked, and says so', async () => {
  const locked = await show({ disabled: true });
  await fireEvent.press(within(screen.getByTestId('meals')).getByLabelText('Breakfast'));
  expect(locked).not.toHaveBeenCalled();
  expect(within(screen.getByTestId('meals')).getByLabelText('Breakfast').props.accessibilityState).toMatchObject({ disabled: true });
});
