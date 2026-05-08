/**
 * SVG icon components for the Empty State library.
 * All icons are 64×64, stroke-based, no fills — consistent with the
 * Quiet Luxury doctrine (bone/ink palette, no decorative colour fills).
 *
 * Import individual icons; tree-shaking keeps bundle size minimal.
 *
 * @module src/ui/empty-states/icons
 */

import React from 'react';
import Svg, { Path, Circle, Line, Rect, G } from 'react-native-svg';

type IconProps = {
  size?: number;
  color?: string;
};

/** Two silhouette figures — represents a client list or roster. */
export function IconPeople({ size = 64, color = '#B1A89F' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx="24" cy="20" r="9" stroke={color} strokeWidth="2" />
      <Path
        d="M6 54c0-9.941 8.059-18 18-18s18 8.059 18 18"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <Circle cx="46" cy="22" r="7" stroke={color} strokeWidth="1.5" strokeDasharray="2 1" />
      <Path
        d="M34 54c0-7.732 5.373-14.183 12.625-15.747"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 1"
      />
    </Svg>
  );
}

/** Clipboard with a checkmark placeholder — represents workouts / plans. */
export function IconClipboard({ size = 64, color = '#B1A89F' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Rect x="12" y="14" width="40" height="44" rx="2" stroke={color} strokeWidth="2" />
      <Path d="M24 14v-4a8 8 0 0 1 16 0v4" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="22" y1="32" x2="42" y2="32" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="22" y1="40" x2="36" y2="40" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="26" y1="14" x2="38" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

/** Bar chart with an upward arrow — represents data / analytics. */
export function IconChartEmpty({ size = 64, color = '#B1A89F' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Rect x="10" y="38" width="10" height="16" rx="1" stroke={color} strokeWidth="2" />
      <Rect x="27" y="28" width="10" height="26" rx="1" stroke={color} strokeWidth="2" />
      <Rect x="44" y="18" width="10" height="36" rx="1" stroke={color} strokeWidth="2" />
      <Path d="M10 12h44" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
    </Svg>
  );
}

/** Magnifying glass with a small X — represents no search results. */
export function IconSearchEmpty({ size = 64, color = '#B1A89F' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx="27" cy="27" r="16" stroke={color} strokeWidth="2" />
      <Line x1="38.5" y1="38.5" x2="54" y2="54" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="21" y1="21" x2="33" y2="33" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="33" y1="21" x2="21" y2="33" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

/** Signal bars with a diagonal cross — represents offline / no network. */
export function IconOffline({ size = 64, color = '#B1A89F' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path
        d="M8 32C17 20 27 14 32 14s15 6 24 18"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="3 2"
        opacity="0.4"
      />
      <Path
        d="M16 40c4-6 9-10 16-10s12 4 16 10"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="3 2"
        opacity="0.6"
      />
      <Path
        d="M24 48c2-3 5-5 8-5s6 2 8 5"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <Circle cx="32" cy="54" r="3" stroke={color} strokeWidth="2" />
      <Line x1="12" y1="12" x2="52" y2="52" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}
