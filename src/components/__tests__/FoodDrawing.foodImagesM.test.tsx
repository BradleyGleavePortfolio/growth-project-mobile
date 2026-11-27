/**
 * FOOD-IMAGES-M cases i and j. j: the five drawings are the picked C2 Style C set, numbers copied from
 * tgp-agent-context handoffs/op-144/ops144/shots/MOCK-C2/src/base.py:198-209 (plate_svg; viewBox 0 0 64 64, fill none,
 * stroke-width 1.5, round caps and joins), drawn camel on the cream C_add tile (C_add.html :120 .c-li .ph: 48, corner
 * 12, the drawing 30 of 48). The jar's <rect x="18" y="16" width="28" height="34" rx="6"/> is drawn as one Path of the
 * same rounded rectangle. i (R5): with drawn absent FoodImage draws what it draws at main, whatever else it is given.
 * The new module and prop are reached loosely so this file type-checks and runs at the base commit.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import FoodImage from '../FoodImage';
import { Colors } from '../../constants/colors';
import { colors as palette, radius } from '../../theme/tokens';
import { getFoodImageUrl } from '../../utils/foodImages';

// The drawn parts as plain host views carrying their svg props (as FoodSearchModal.refine968.test.tsx:30-35 does).
jest.mock('react-native-svg', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const part = (kind: string) => (p: Record<string, unknown>) => R.createElement(View, { ...p, svgKind: kind });
  return { __esModule: true, default: part('Svg'), Svg: part('Svg'), Path: part('Path'), Ellipse: part('Ellipse'), Circle: part('Circle') };
});

type Node = { type: string; props: Record<string, any>; queryAll: (m: (n: Node) => boolean) => Node[] };
const flat = (n: unknown) => (StyleSheet.flatten((n as Node).props.style) ?? {}) as Record<string, unknown>;
const svgsIn = (n: unknown, kind = 'Svg') => [n as Node, ...(n as Node).queryAll(() => true)].filter((x) => x.props?.svgKind === kind);
const images = (root: unknown) => [root as Node, ...(root as Node).queryAll(() => true)].filter((x) => x.type === 'Image');
const hidden = { includeHiddenElements: true };
// The component this job adds (src/components/FoodDrawing.tsx); absent at the base.
const FoodDrawing = (props: { kind: string; size: number }) => React.createElement(jest.requireActual('../FoodDrawing').default, props);
// FoodImage's new prop, passed so the base's type of FoodImage does not reject it.
const withDrawing = (props: Record<string, unknown>) => React.createElement(FoodImage as any, props);

// base.py:201-205, verbatim, the jar's rect as its Path (the job text's d string).
const PICKED: Record<string, { ellipses: number[][]; paths: string[] }> = {
  bowl: { ellipses: [[32, 30, 24, 7]], paths: ['M8 30c1 13 10 20 24 20s23-7 24-20', 'M20 27c2-5 6-7 10-6M34 22c4-3 9-2 11 2M27 24c1-2 3-3 5-3'] },
  plate: { ellipses: [[32, 34, 26, 11], [32, 33, 17, 6.5]], paths: ['M22 32c3-4 8-5 12-3M36 34c3-2 6-2 8 0'] },
  glass: { ellipses: [], paths: ['M20 12h24l-3 38H23z', 'M21.5 26h21', 'M30 12c0-4 2-7 6-8'] },
  cup: { ellipses: [], paths: ['M14 22h30v10a15 15 0 0 1-30 0z', 'M44 25h4a5 5 0 0 1 0 10h-5', 'M24 16c0-3 3-3 3-6M32 16c0-3 3-3 3-6'] },
  jar: { ellipses: [], paths: ['M24 16h16a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6z', 'M20 16v-5h24v5M18 30h28'] },
};
const KINDS = ['cup', 'glass', 'bowl', 'jar', 'plate'];
const ellipseNumbers = (svg: unknown) => svgsIn(svg, 'Ellipse').map((e) => ['cx', 'cy', 'rx', 'ry'].map((k) => Number(e.props[k])));
const pathDs = (svg: unknown) => svgsIn(svg, 'Path').map((p) => p.props.d);
const SVG_PROPS = { viewBox: '0 0 64 64', fill: 'none', stroke: palette.camel, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };

describe('j. each kind is the picked drawing, part for part (red at the base for the four new kinds)', () => {
  it.each(KINDS)('%s: base.py\'s ellipses and paths, viewBox 64, camel at 1.5, round caps and joins, testID food-drawing-%s', async (kind) => {
    await render(<FoodDrawing kind={kind} size={30} />);
    const [svg] = screen.getAllByTestId(`food-drawing-${kind}`, hidden);
    expect(svg.props.svgKind).toBe('Svg');
    expect(svg.props).toMatchObject({ width: 30, height: 30, ...SVG_PROPS });
    expect(ellipseNumbers(svg)).toEqual(PICKED[kind].ellipses);
    expect(pathDs(svg)).toEqual(PICKED[kind].paths);
    expect(svgsIn(svg, 'Circle')).toHaveLength(0);
  });

  it.each(KINDS)('FoodImage drawn with drawing=%s: the cream 48 tile at corner 12, hidden from the reader, holding that drawing at 30', async (kind) => {
    await render(withDrawing({ name: 'Chicken breast, roasted', size: 48, drawn: true, drawing: kind }));
    const tile = screen.getByTestId('food-tile-drawing', hidden);
    expect(flat(tile)).toMatchObject({ width: 48, height: 48, borderRadius: radius.input, backgroundColor: palette.cream });
    expect(tile.props.accessibilityElementsHidden).toBe(true);
    expect(tile.props.importantForAccessibility).toBe('no-hide-descendants');
    const svgs = svgsIn(tile);
    expect(svgs).toHaveLength(1);
    expect(svgs[0].props.testID).toBe(`food-drawing-${kind}`);
    expect(svgs[0].props).toMatchObject({ width: 30, height: 30, stroke: palette.camel, strokeWidth: 1.5 });
    expect(pathDs(svgs[0])).toEqual(PICKED[kind].paths);
    expect(screen.queryByText('C')).toBeNull();
  });

  it('FoodImage drawn with no drawing: the bowl as at main, 1 Ellipse and 2 Paths of base.py (green at both)', async () => {
    await render(<FoodImage name="Chicken breast, roasted" size={48} drawn />);
    const tile = screen.getByTestId('food-tile-drawing', hidden);
    const [svg] = svgsIn(tile);
    expect(svg.props).toMatchObject({ width: 30, height: 30, ...SVG_PROPS });
    expect(ellipseNumbers(svg)).toEqual(PICKED.bowl.ellipses);
    expect(pathDs(svg)).toEqual(PICKED.bowl.paths);
  });

  it('a stock photo stays the photo with a drawing given; a failed one falls back to that drawing', async () => {
    expect(getFoodImageUrl('Banana')).not.toBe('');
    await render(withDrawing({ name: 'Banana', size: 48, drawn: true, drawing: 'bowl' }));
    expect(images(screen.root).map((i) => i.props.source.uri)).toEqual([getFoodImageUrl('Banana')]);
    expect(screen.queryByTestId('food-tile-drawing', hidden)).toBeNull();
    await fireEvent(images(screen.root)[0] as never, 'error');
    expect(svgsIn(screen.getByTestId('food-tile-drawing', hidden))).toHaveLength(1);
  });
});

describe('i. R5: with drawn absent FoodImage draws exactly what it draws at main (green at both)', () => {
  it.each(KINDS)('drawing=%s without drawn: the forest letter tile, no drawing, no photo', async (kind) => {
    await render(withDrawing({ name: 'Chicken breast, roasted', size: 44, drawing: kind }));
    const letter = screen.getByText('C');
    expect(flat((letter as unknown as { parent: unknown }).parent)).toMatchObject({ backgroundColor: Colors.primary, width: 44, height: 44,
      borderRadius: radius.input });
    expect(screen.queryByTestId('food-tile-drawing', hidden)).toBeNull();
    expect(svgsIn(screen.root)).toHaveLength(0);
    expect(images(screen.root)).toHaveLength(0);
  });

  it('drawing given without drawn, a stock photo: the photo, and the letter (not a drawing) when it fails', async () => {
    await render(withDrawing({ name: 'Latte', size: 44, drawing: 'cup' }));
    expect(images(screen.root).map((i) => i.props.source.uri)).toEqual([getFoodImageUrl('Latte')]);
    await fireEvent(images(screen.root)[0] as never, 'error');
    expect(screen.getByText('L')).toBeTruthy();
    expect(svgsIn(screen.root)).toHaveLength(0);
  });

  it('the coach\'s meal picker (MealPickerScreen.tsx:145) calls FoodImage exactly as at main: no drawn, no drawing', () => {
    const picker = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'coach', 'meals', 'MealPickerScreen.tsx'), 'utf8');
    expect(picker.match(/<FoodImage\b[^>]*\/>/g)).toEqual(['<FoodImage name={f.name} brand={f.brand ?? undefined} size={44} />']);
  });

  it('the add sheet (FoodThumb) is the only caller that passes drawn (a source read: who may pass the prop)', () => {
    const src = path.join(__dirname, '..', '..');
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/<FoodImage\b[^>]*\bdrawn\b/.test(fs.readFileSync(full, 'utf8'))) callers.push(path.relative(src, full));
      }
    };
    walk(src);
    expect(callers).toEqual([path.join('components', 'log', 'FoodSearchView.tsx')]);
  });
});
