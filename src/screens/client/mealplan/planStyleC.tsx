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
import { gold, layout, lightTokens, radius, spacing, typography } from '../../../theme/tokens';

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

interface MastheadProps {
  eyebrow?: string | null;
  title: string;
  titleTestID?: string;
  testID?: string;
  children?: React.ReactNode;
}

/** Deep-forest masthead: letterspaced eyebrow, serif title, then the screen's summary. */
export function PlanMasthead({ eyebrow, title, titleTestID, testID, children }: MastheadProps) {
  return (
    <View style={s.mast} testID={testID}>
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
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One stop on the day's gutter: a hollow dot level with the eyebrow, a line on to the next stop. */
export function TimelineRow({ line, dot, bg, last, children, style, testID }: TimelineProps) {
  return (
    <View style={[s.tlRow, style]} testID={testID}>
      <View style={s.gutter} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {!last ? <View style={[s.tlLine, { backgroundColor: line }]} /> : null}
        <View style={[s.dot, { borderColor: dot, backgroundColor: bg }]} />
      </View>
      <View style={s.tlBody}>{children}</View>
    </View>
  );
}

const DOT = 11;
const GUTTER = 24;

export const planStyleC = StyleSheet.create({
  /** Inner card on the cream paper (state and stats cards). */
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  /** Serif meal / row name (C2: 21 pt serif; the scale's h3). */
  name: { ...typography.h3 },
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
  title: { ...typography.h1, color: mast.ink },
  line: { ...typography.bodySmall, color: mast.ink, marginTop: spacing.sm },
  lineMuted: { color: mast.muted },
  rule: { height: 1, alignSelf: 'stretch', backgroundColor: mast.rule, marginTop: spacing.lg },
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
