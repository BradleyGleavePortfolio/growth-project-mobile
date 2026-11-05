/**
 * C2 Style C parts for the meal plan, macros and fasting screens (STYLE-MEALPLAN-M;
 * planning/MOCKUP3/C2/index.md sections 3 and 5). The forest masthead (the frame's
 * #2C4A36, surface.forestBand) carries the screen's eyebrow and serif title over a
 * 1 pt gold foot rule (gold.500, non-text); the cream paper page (top radius 24)
 * overlaps it; the timeline row draws the gutter with a hollow dot per meal.
 * Masthead colours are the same in both schemes, so they come from lightTokens.
 * These parts hold no words: every string comes from the screen, as on main.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { gold, layout, lightTokens, radius, spacing, typography } from '../../../theme/tokens';
import type { SlotLabel } from '../../../api/mealTemplatesApi';

/** Masthead roles (identical in both schemes). */
export const mast = {
  ground: lightTokens.surface.forestBand,
  ink: lightTokens.textOnAccent,
  muted: lightTokens.textOnMastheadMuted,
  rule: gold[500],
} as const;

/**
 * The coach-voice italic once the face has loaded; the roman serif until then
 * (TrainToday and Learn load it the same way). The font module is required
 * lazily so screens whose tests do not stub expo-font still mount; where it
 * cannot load, the roman serif stays, which is the same words and size.
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

export function useCoachItalic(): StyleProp<TextStyle> {
  const [loaded] = useItalicFace({ CormorantGaramond_400Regular_Italic: italicFace });
  return loaded ? s.italic : null;
}

/**
 * The phone's status-bar inset in the masthead's forest (FIX-927, LO-927 B1):
 * the screen asks the app's StatusBarBand for forest while it is focused, as
 * Progress v2 and the coach meal screens do. The band needs a navigator, so it
 * mounts only inside one (every app route is); a screen test without a
 * NavigationContainer, or one that stubs @react-navigation/native, still mounts.
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
function ForestBand({ color }: { color: string }) {
  bandHook?.(color);
  return null;
}

interface MastheadProps {
  eyebrow?: string | null;
  title: string;
  titleTestID?: string;
  testID?: string;
  children?: React.ReactNode;
}

/** Deep-forest masthead: letterspaced eyebrow, serif title, then the screen's summary. */
export function PlanMasthead({ eyebrow, title, titleTestID, testID, children }: MastheadProps) {
  const inNavigator = React.useContext(NavigatorContext) != null;
  return (
    <View style={s.mast} testID={testID}>
      {inNavigator && bandHook ? <ForestBand color={mast.ground} /> : null}
      {/* iOS overscroll above the masthead stays forest, never a bone strip. */}
      <View style={s.overscroll} importantForAccessibility="no" accessibilityElementsHidden pointerEvents="none" />
      {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
      <Text style={s.title} accessibilityRole="header" testID={titleTestID}>{title}</Text>
      {children}
      <View style={s.rule} importantForAccessibility="no" accessibilityElementsHidden />
    </View>
  );
}

/** Short Inter summary line on the masthead (white, or muted for meta). */
export function MastLine({ children, muted, testID, style }: { children: React.ReactNode; muted?: boolean; testID?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.line, muted && s.lineMuted, style]} testID={testID}>{children}</Text>;
}

/**
 * A gold progress line on the masthead (C2 C_day's gold dashes; a share from
 * 0 to 1 the screen already shows in words). Non-text, hidden from readers.
 */
export function GoldLine({ share, testID }: { share: number; testID?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100;
  return (
    <View style={s.goldTrack} testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[s.goldFill, { width: `${pct}%` }]} />
    </View>
  );
}

/** One target tile on the masthead (K5 Style C): serif value over an Inter label. */
export function MastTile({ value, label, testID }: { value: string; label: string; testID?: string }) {
  return (
    <View style={s.tile} testID={testID} accessible>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

/** The paper page: top radius 24, overlapping the masthead's lower edge. */
export function PaperPage({ children, bg, testID }: { children: React.ReactNode; bg: string; testID?: string }) {
  return <View style={[s.paper, { backgroundColor: bg }]} testID={testID}>{children}</View>;
}

interface TimelineProps {
  /** Hairline colour for the gutter line and the hollow dot. */
  line: string;
  dot: string;
  bg: string;
  last?: boolean;
  /** A filled dot (C2: a meal logged, a fast completed); hollow otherwise. */
  filled?: boolean;
  /** Dot drop from the row top, to sit level with a serif first line (default: level with an eyebrow). */
  dotTop?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One stop on the day's gutter: a hollow dot level with the eyebrow, a line on to the next stop. */
export function TimelineRow({ line, dot, bg, last, filled, dotTop, children, style, testID }: TimelineProps) {
  return (
    <View style={s.tlRow} testID={testID}>
      <View style={s.gutter} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {!last ? <View style={[s.tlLine, { backgroundColor: line }, dotTop != null && { top: dotTop + DOT + 3 }]} /> : null}
        <View style={[s.dot, { borderColor: dot, backgroundColor: filled ? dot : bg }, dotTop != null && { marginTop: dotTop }]} />
      </View>
      <View style={[s.tlBody, style]}>{children}</View>
    </View>
  );
}

/**
 * The cream tile beside a meal (C2 C_day; #191-D2: a line drawing on a cream
 * tile where no photo of that food exists). Meal templates carry no photo and
 * no food group, so the drawing is the meal's own vessel by slot: a bowl for
 * breakfast and snack, a plate for lunch and dinner, a glass for the workout
 * shakes. It names no food and is hidden from readers.
 */
export function MealArt({ slot, testID }: { slot: SlotLabel | string; testID?: string }) {
  const kind = slot === 'lunch' || slot === 'dinner' ? 'plate'
    : slot === 'preworkout' || slot === 'postworkout' ? 'glass' : 'bowl';
  const c = gold[500];
  return (
    <View style={s.art} testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={36} height={36} viewBox="0 0 36 36" fill="none">
        {kind === 'bowl' ? (
          <>
            <Path d="M5 17h26c0 7-5.8 12-13 12S5 24 5 17z" stroke={c} strokeWidth={1.4} strokeLinejoin="round" />
            <Path d="M10 17c0-3 3.6-5 8-5s8 2 8 5" stroke={c} strokeWidth={1.2} />
            <Circle cx={14} cy={13.6} r={1.2} stroke={c} strokeWidth={1} />
            <Circle cx={19.5} cy={12.4} r={1.2} stroke={c} strokeWidth={1} />
            <Circle cx={24} cy={14.6} r={1.1} stroke={c} strokeWidth={1} />
          </>
        ) : null}
        {kind === 'plate' ? (
          <>
            <Ellipse cx={18} cy={19} rx={14} ry={7} stroke={c} strokeWidth={1.4} />
            <Ellipse cx={18} cy={18.4} rx={9} ry={4.2} stroke={c} strokeWidth={1.1} />
            <Path d="M13 17.6c1.6-1.4 3.4-1.2 5 0s3.4 1.4 5 0" stroke={c} strokeWidth={1.1} strokeLinecap="round" />
          </>
        ) : null}
        {kind === 'glass' ? (
          <>
            <Path d="M11 8h14l-2 21H13L11 8z" stroke={c} strokeWidth={1.4} strokeLinejoin="round" />
            <Line x1={11.8} y1={15} x2={24.2} y2={15} stroke={c} strokeWidth={1.1} />
            <Rect x={21} y={4} width={1.4} height={9} rx={0.7} stroke={c} strokeWidth={0.8} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const DOT = 11;
const ART = 56;
const GUTTER = 24;

export const planStyleC = StyleSheet.create({
  /** Inner card on the cream paper (state and stats cards). */
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  /**
   * Serif meal / row name: the C2 frame's meal-name size (21 pt in Cormorant
   * Garamond regular, the h2 face; the scale's h3 is the 500 weight at 20, so
   * it is not the frame's size). Line height 27 keeps the serif's 1.21 floor.
   */
  name: { ...typography.h2, fontSize: 21, lineHeight: 27, letterSpacing: 0 },
  meta: { ...typography.caption, letterSpacing: 0.2 },
  eyebrow: { ...typography.eyebrow },
  /** Forest primary action, radius 12, 54 pt tall. */
  primary: {
    minHeight: layout.buttonHeight, borderRadius: radius.button, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  primaryLabel: { ...typography.bodyMd },
});

const s = StyleSheet.create({
  mast: {
    backgroundColor: mast.ground,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'] + radius.sheet,
  },
  eyebrow: { ...typography.eyebrow, color: mast.muted, marginBottom: spacing.sm },
  // C2's masthead title is larger than the scale's h1 (about 38 pt in C_day); 36 pt keeps the serif's line-height floor.
  title: { ...typography.h1, fontSize: 36, lineHeight: 44, color: mast.ink },
  line: { ...typography.bodySmall, color: mast.ink, marginTop: spacing.sm },
  lineMuted: { color: mast.muted },
  rule: { height: 1, alignSelf: 'stretch', backgroundColor: mast.rule, marginTop: spacing.lg },
  overscroll: { position: 'absolute', left: 0, right: 0, top: -1000, height: 1000, backgroundColor: mast.ground },
  goldTrack: {
    height: 4, borderRadius: 2, alignSelf: 'stretch', marginTop: spacing.md,
    backgroundColor: lightTokens.data.plannedOnDark, overflow: 'hidden',
  },
  goldFill: { height: 4, borderRadius: 2, backgroundColor: gold[300] },
  tile: {
    flexGrow: 1, flexBasis: 88, minHeight: 64, borderRadius: radius.input,
    borderWidth: 1, borderColor: lightTokens.data.frameOnDark, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, justifyContent: 'center',
  },
  tileValue: { ...typography.h2, letterSpacing: 0, color: mast.ink, fontVariant: ['lining-nums'] },
  tileLabel: { ...typography.caption, color: mast.muted },
  art: {
    width: ART, height: ART, borderRadius: radius.input, backgroundColor: gold[100],
    alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md,
  },
  italic: { fontFamily: 'CormorantGaramond_400Regular_Italic', fontWeight: '400' },
  paper: {
    marginTop: -radius.sheet,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing['3xl'],
    flexGrow: 1,
  },
  tlRow: { flexDirection: 'row' },
  gutter: { width: GUTTER, alignItems: 'center' },
  tlLine: { position: 'absolute', top: 4 + DOT, bottom: -4, width: StyleSheet.hairlineWidth * 2 },
  dot: { marginTop: 1, width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5 },
  tlBody: { flex: 1, minWidth: 0, paddingLeft: spacing.sm },
});
