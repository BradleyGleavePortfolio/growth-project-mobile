import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

// REFINE-968: the add sheet's drawn glyphs, as C_add.html :155 draws them (a 24-unit outline at stroke 1.6, sized by
// the caller): the close cross, the search magnifier, the Quick add tile's bolt and the Photo of a meal tile's camera
// (MEAL-PHOTO-M, C_add.html's first .c-big2 tile). Each sits beside its own words or label.
const GLYPHS = {
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="M16 16l4 4" />
    </>
  ),
  bolt: <Path d="M13 3.5L6 13h5l-1 7.5 7-9.5h-5z" />,
  camera: (
    <>
      <Path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
      <Circle cx="12" cy="13.5" r="3.5" />
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
