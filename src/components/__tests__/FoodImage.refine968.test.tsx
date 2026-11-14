/**
 * REFINE-968 (operator ruling 6, undo "letter tile"): the add sheet's rows draw the C_add bowl on a cream tile where
 * there is no photo, through one new optional FoodImage prop that only FoodSearchView passes. With the prop absent
 * FoodImage draws exactly what it drew at 822855434 (the letter tile or the stock photo), so the coach's meal picker
 * (MealPickerScreen.tsx, the food bank row) is unchanged. C_add.html :120 (.c-li .ph) is the drawn tile.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import FoodImage from '../FoodImage';
import { Colors } from '../../constants/colors';
import { colors } from '../../theme';
import { colors as palette, radius } from '../../theme/tokens';
import { getFoodImageUrl } from '../../utils/foodImages';

type Node = { type: string; props: Record<string, any>; children: Array<Node | string>; queryAll: (m: (n: Node) => boolean) => Node[] };
const flat = (n: unknown) => (StyleSheet.flatten((n as Node).props.style) ?? {}) as Record<string, unknown>;
// The Image host itself when it is the root, or the Image hosts inside it.
const images = (root: unknown) => [root as Node, ...(root as Node).queryAll(() => true)].filter((x) => x.type === 'Image');
const NO_PHOTO = 'Chicken breast, roasted';
const PHOTO = 'Latte';

beforeAll(() => {
  expect(getFoodImageUrl(NO_PHOTO)).toBe('');
  expect(getFoodImageUrl(PHOTO)).not.toBe('');
});

describe('with the new prop absent, FoodImage draws as at the head', () => {
  it.each([[48], [44], [64]])('no photo: the forest letter tile at %i pt, corner 12, no drawing', async (size) => {
    await render(<FoodImage name={NO_PHOTO} size={size} />);
    const letter = screen.getByText('C');
    expect(flat(letter)).toMatchObject({ color: Colors.textOnPrimary, fontWeight: '500', fontSize: size * 0.4 });
    expect(flat((letter as unknown as { parent: unknown }).parent)).toMatchObject({ backgroundColor: Colors.primary, width: size, height: size,
      borderRadius: radius.input, justifyContent: 'center', alignItems: 'center' });
    expect(screen.queryByTestId('food-tile-drawing', { includeHiddenElements: true })).toBeNull();
    expect(images(screen.root)).toHaveLength(0);
  });

  it('a stock photo: one Image of getFoodImageUrl(name), corner 12, the success fill behind it', async () => {
    await render(<FoodImage name={PHOTO} size={44} />);
    const [img] = images(screen.root);
    expect(img.props.source).toEqual({ uri: getFoodImageUrl(PHOTO) });
    expect(flat(img)).toEqual({ width: 44, height: 44, borderRadius: radius.input, backgroundColor: colors.feedback.successBg });
    expect(screen.queryByTestId('food-tile-drawing', { includeHiddenElements: true })).toBeNull();
  });

  it('a stock photo that fails falls back to the letter, not the drawing', async () => {
    await render(<FoodImage name={PHOTO} size={48} />);
    await fireEvent(images(screen.root)[0] as never, 'error');
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.queryByTestId('food-tile-drawing', { includeHiddenElements: true })).toBeNull();
  });

  it('the coach\'s meal picker bank row still calls FoodImage without the new prop, as at the head', () => {
    const picker = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'coach', 'meals', 'MealPickerScreen.tsx'), 'utf8');
    const calls = picker.match(/<FoodImage\b[^>]*\/>/g) ?? [];
    expect(calls).toEqual(['<FoodImage name={f.name} brand={f.brand ?? undefined} size={44} />']);
  });

  it('the coach\'s bank row (name, brand, 44 pt): the letter tile or the stock photo exactly as at the head', async () => {
    const view = await render(<FoodImage name={NO_PHOTO} brand="Made-up Farm" size={44} />);
    expect(screen.getByText('C')).toBeTruthy();
    expect(screen.queryByTestId('food-tile-drawing', { includeHiddenElements: true })).toBeNull();
    await view.rerender(<FoodImage name={PHOTO} brand="Made-up Farm" size={44} />);
    expect(images(screen.root).map((i) => i.props.source.uri)).toEqual([getFoodImageUrl(PHOTO)]);
  });
});

describe('with the new prop (the add sheet only)', () => {
  it('no photo: the cream tile at corner 12 with the bowl (30 of 48), hidden from the reader, no letter', async () => {
    await render(<FoodImage name={NO_PHOTO} size={48} drawn />);
    const tile = screen.getByTestId('food-tile-drawing', { includeHiddenElements: true });
    expect(flat(tile)).toMatchObject({ width: 48, height: 48, borderRadius: radius.input, backgroundColor: palette.cream });
    expect(tile.props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByText('C')).toBeNull();
  });

  it('a stock photo stays the photo; a failed one falls back to the drawing', async () => {
    await render(<FoodImage name={PHOTO} size={48} drawn />);
    expect(images(screen.root).map((i) => i.props.source.uri)).toEqual([getFoodImageUrl(PHOTO)]);
    await fireEvent(images(screen.root)[0] as never, 'error');
    expect(screen.getByTestId('food-tile-drawing', { includeHiddenElements: true })).toBeTruthy();
  });
});
