import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

// REFINE-968: the add sheet's drawn glyphs, as C_add.html :155 draws them (a 24-unit outline at stroke 1.6, sized by
// the caller): the close cross and the search magnifier. Each sits beside its own words or label.
const GLYPHS = {
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="M16 16l4 4" />
    </>
  ),
};

export function SheetGlyph({ name, size, color }: { name: keyof typeof GLYPHS; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[name]}
    </Svg>
  );
}
