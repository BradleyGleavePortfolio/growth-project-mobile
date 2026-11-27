import React from 'react';
import Svg, { Ellipse, Path } from 'react-native-svg';
import { colors as palette } from '../theme/tokens';

/** FOOD-IMAGES-M (owner #191-D2 op 1, #192-E6): the five drawings of the picked C2 Style C add sheet, nothing else. */
export type FoodDrawingKind = 'cup' | 'glass' | 'bowl' | 'jar' | 'plate';

type Part = { d: string } | { cx: string; cy: string; rx: string; ry: string };

// MOCK-C2 src/base.py:198-209 (plate_svg), the numbers verbatim; the jar's rect (x 18, y 16, 28 by 34, rx 6) is one Path
// of the same rounded rectangle. A new drawing needs the owner's pick first (FOOD-ART-MOCK, #203-E33).
const PARTS: Record<FoodDrawingKind, Part[]> = {
  bowl: [
    { cx: '32', cy: '30', rx: '24', ry: '7' },
    { d: 'M8 30c1 13 10 20 24 20s23-7 24-20' },
    { d: 'M20 27c2-5 6-7 10-6M34 22c4-3 9-2 11 2M27 24c1-2 3-3 5-3' },
  ],
  plate: [
    { cx: '32', cy: '34', rx: '26', ry: '11' },
    { cx: '32', cy: '33', rx: '17', ry: '6.5' },
    { d: 'M22 32c3-4 8-5 12-3M36 34c3-2 6-2 8 0' },
  ],
  glass: [{ d: 'M20 12h24l-3 38H23z' }, { d: 'M21.5 26h21' }, { d: 'M30 12c0-4 2-7 6-8' }],
  cup: [
    { d: 'M14 22h30v10a15 15 0 0 1-30 0z' },
    { d: 'M44 25h4a5 5 0 0 1 0 10h-5' },
    { d: 'M24 16c0-3 3-3 3-6M32 16c0-3 3-3 3-6' },
  ],
  jar: [
    { d: 'M24 16h16a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6z' },
    { d: 'M20 16v-5h24v5M18 30h28' },
  ],
};

/** C_add.html :120 and :155: one line drawing, camel at stroke 1.5 on the cream tile (the tile is FoodImage's). */
export default function FoodDrawing({ kind, size }: { kind: FoodDrawingKind; size: number }) {
  return (
    <Svg testID={`food-drawing-${kind}`} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={palette.camel}
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {PARTS[kind].map((part, i) => ('d' in part ? <Path key={i} d={part.d} /> : <Ellipse key={i} {...part} />))}
    </Svg>
  );
}
