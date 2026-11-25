/**
 * C1 Style C v2 parts for the client workout screens (STYLE-WORKOUTS-M): the exercise library, an exercise's page,
 * the assigned workout and the past-workout edit. Used only by those four screens. The numbers are read from the
 * picked drawings at 2x (planning/MOCKUP3/C1/style-c-v2/C2_*_ios390_100.png; for the library, the nearest picked
 * drawing K3 style-c/C_picker_ios390_100.png). Colours come from the theme only; these parts hold no words.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import type { SemanticTokens } from '../../../theme/tokens';
import { layout, lightTokens, spacing, typography } from '../../../theme/tokens';

/**
 * The library's masthead roles (K3 C_picker on C1 v2 tokens). They are the same in both schemes (darkTokens keeps
 * lightTokens' surface.masthead, surface.forestBand, data.leaf, data.frameOnDark, textOnAccent and
 * textOnMastheadMuted), so they come from lightTokens, as planStyleC's masthead does.
 */
export const mast = {
  ground: lightTokens.surface.masthead,
  field: lightTokens.surface.forestBand,
  line: lightTokens.data.frameOnDark,
  chosen: lightTokens.data.leaf,
  ink: lightTokens.textOnAccent,
  muted: lightTokens.textOnMastheadMuted,
} as const;

/** Sizes read from the frames (pixel rows at 2x in each comment). */
export const wsc = {
  /** C2_today cols 48-103, rows 890-945: the block letter chip. */
  letterChip: 28,
  /** C2_today cols 48-51: the chip's moss line (1.5 pt, as TrainDay draws it). */
  letterLine: 1.5,
  /** C2_today cols 104-132: chip to name. */
  letterGap: 14,
  /** C2_adjusted cols 128-133: the forest edge of a coach-changed row. */
  changedEdge: 3,
  /** K3 C_picker rows 204-295: the search field on the masthead. */
  searchHeight: 46,
  /** K3 C_picker rows 331-392: the drawn pill inside its 44 pt target. */
  pillHeight: 32,
} as const;

/**
 * A section head as C2_detail draws "YOUR HISTORY" (rows 868-891): the eyebrow, 4 pt, then a full-width hairline;
 * the first value sits 12 pt under the rule and the section starts 18 pt under the one before.
 */
export function sectionHead(sc: SemanticTokens): TextStyle {
  return {
    ...typography.eyebrow,
    color: sc.textMuted,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
    marginTop: layout.sectionPadY,
    marginBottom: spacing.md,
  };
}

/**
 * The coach's words in Cormorant italic once the face has loaded (TrainToday loads it the same way); the roman serif
 * until then. The font module is required lazily, as planStyleC does, so a screen test that does not stub expo-font
 * still mounts.
 */
type FontsHook = (map: Record<string, unknown>) => [boolean, Error | null];
let fontsHook: FontsHook | null = null;
let italicFace: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require('@expo-google-fonts/cormorant-garamond');
  fontsHook = m.useFonts;
  italicFace = m.CormorantGaramond_400Regular_Italic;
} catch {
  fontsHook = null;
}
const noFonts: FontsHook = () => [false, null];
const useItalicFace: FontsHook = fontsHook ?? noFonts;

const italic = StyleSheet.create({ face: { fontFamily: 'CormorantGaramond_400Regular_Italic', fontWeight: '400' } });
export function useCoachItalic(): StyleProp<TextStyle> {
  const [loaded] = useItalicFace({ CormorantGaramond_400Regular_Italic: italicFace });
  return loaded ? italic.face : null;
}

/**
 * The phone's status-bar inset in the masthead's ground while the screen is focused (LO-927 B1): the app's
 * StatusBarBand otherwise paints bone over the top of a forest bar. The band needs a navigator, so it mounts only
 * inside one (every app route is); a screen test without a NavigationContainer still mounts.
 */
const NoNavigator = React.createContext<unknown>(null);
let NavigatorContext: React.Context<unknown> = NoNavigator;
let bandHook: ((color: string) => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nav = require('@react-navigation/native');
  if (nav?.NavigationContext && typeof nav.useFocusEffect === 'function') {
    NavigatorContext = nav.NavigationContext;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    bandHook = require('../../../components/StatusBarBand').useStatusBarBand;
  }
} catch {
  bandHook = null;
}
function Band({ color }: { color: string }) {
  bandHook?.(color);
  return null;
}
export function MastheadBand({ color }: { color: string }) {
  const navigation = React.useContext(NavigatorContext);
  return navigation && bandHook ? <Band color={color} /> : null;
}
