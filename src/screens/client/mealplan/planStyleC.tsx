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
import { StyleSheet, Text, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { colors, gold, layout, lightTokens, radius, spacing, typography } from '../../../theme/tokens';
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
  /**
   * GOAL-927-M RULING 9: the masthead's ground, its status-bar band and its iOS overscroll; the C2 forest band
   * unless a screen draws K5's deep forest (Macro targets).
   */
  ground?: string;
  /**
   * How the masthead ends: 'paper' (C2 C_day: the gold rule 4 pt above the paper that overlaps it), 'short'
   * (C8 C_fasting: the title, then the paper; no rule), 'round' (K5 C_macros: a rounded foot, the cards on
   * the page below it; no rule).
   */
  foot?: 'paper' | 'short' | 'round';
  /** C_loading: still bones where the eyebrow and title will be (the block around them says main's Loading). */
  bones?: boolean;
  children?: React.ReactNode;
}

/** Deep-forest masthead: letterspaced eyebrow, serif title, then the screen's summary. */
export function PlanMasthead({ eyebrow, title, titleTestID, testID, ground = mast.ground, foot = 'paper', bones, children }: MastheadProps) {
  const inNavigator = React.useContext(NavigatorContext) != null;
  return (
    <View style={[s.mast, { backgroundColor: ground }, foot === 'short' && s.mastShort, foot === 'round' && s.mastRound]} testID={testID}>
      {inNavigator && bandHook ? <ForestBand color={ground} /> : null}
      {/* iOS overscroll above the masthead stays in its ground, never a bone strip. */}
      <View style={[s.overscroll, { backgroundColor: ground }]} importantForAccessibility="no" accessibilityElementsHidden pointerEvents="none" />
      {bones ? (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={[s.bone, s.boneTitle]} testID="plan-mast-bone" />
          <View style={[s.bone, s.boneLine]} testID="plan-mast-bone" />
        </View>
      ) : (
        <>
          {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
          <Text style={s.title} accessibilityRole="header" testID={titleTestID}>{title}</Text>
          {children}
        </>
      )}
      {foot === 'paper' ? <View style={s.rule} importantForAccessibility="no" accessibilityElementsHidden /> : null}
    </View>
  );
}

/** Short Inter summary line on the masthead (white, or muted for meta). */
export function MastLine({ children, muted, testID, style }: { children: React.ReactNode; muted?: boolean; testID?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.line, muted && s.lineMuted, style]} testID={testID}>{children}</Text>;
}

/**
 * C2 C_day's masthead summary: one gold mark per meal (eaten ones filled, from the left) beside what is left of
 * the day's target. The marks are non-text and hidden from readers; the line says the same in words.
 */
export function MastProgress({ done, line, segTestID }: { done: boolean[]; line: string; segTestID?: string }) {
  const sorted = [...done].sort((a, b) => Number(b) - Number(a));
  return (
    <View style={s.progress}>
      <View style={s.segs} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {sorted.map((d, i) => <View key={i} style={[s.seg, d && s.segDone]} testID={segTestID} />)}
      </View>
      <Text style={s.progressLine}>{line}</Text>
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

/** The paper page: top radius 24, overlapping the masthead's lower edge (C2 C_day, C8 C_fasting). */
export function PaperPage({ children, bg, testID }: { children: React.ReactNode; bg: string; testID?: string }) {
  return <View style={[s.paper, { backgroundColor: bg }]} testID={testID}>{children}</View>;
}

/** C2 C_day's gutter line: 1.5 pt round dots (the drawing's 1.5px dotted rule), drawn in svg so iOS and Android match. */
function Dots({ color }: { color: string }) {
  return (
    <Svg width={LINE} height="100%">
      <Line x1={LINE / 2} y1={LINE / 2} x2={LINE / 2} y2="100%" stroke={color} strokeWidth={LINE} strokeLinecap="round" strokeDasharray="0.01 3" />
    </Svg>
  );
}

interface TimelineProps {
  /** Colour of the gutter's dotted line. */
  line: string;
  /** The mark's ring (and its fill when filled). */
  dot: string;
  bg: string;
  last?: boolean;
  /** A filled mark (C2 C_day: a meal eaten); hollow otherwise. */
  filled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  markTestID?: string;
}

/**
 * One stop on the day's gutter: a 14 pt mark level with the eyebrow, and the dotted line on to the next
 * stop's mark, at the mark's left edge as C_day draws it.
 */
export function TimelineRow({ line, dot, bg, last, filled, children, style, testID, markTestID }: TimelineProps) {
  return (
    <View style={s.tlRow} testID={testID}>
      <View style={s.gutter} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {!last ? <View style={s.tlLine} testID="plan-gutter-line"><Dots color={line} /></View> : null}
        <View style={[s.dot, { borderColor: dot, backgroundColor: filled ? dot : bg }]} testID={markTestID} />
      </View>
      <View style={[s.tlBody, style]}>{children}</View>
    </View>
  );
}

/** The drawn time column's width: 54 pt, growing with the text size so "12:35 pm" never wraps at 130 percent. */
export function useTimeColumn(): number {
  const { fontScale } = useWindowDimensions();
  return Math.round(TIME * Math.min(Math.max(fontScale || 1, 1), 1.6));
}

/** C2 C_day's time column left of the gutter (Inter 500 12, right-aligned); empty when the meal has no time. */
export function TimeCell({ text, width, ink }: { text: string; width: number; ink: string }) {
  return <Text style={[s.time, { width, color: ink }]}>{text}</Text>;
}

/**
 * C2 C_day's gold now line: the phone's clock in the time column, the dotted line running on through it, a gold
 * dot and rule across the page. No Add (the Food tab's add sheet is not on this screen). Decorative: the clock is
 * hidden from readers, as the line holds no other words.
 */
export function NowRow({ clock, width, line, ink, testID }: { clock: string; width: number; line: string; ink: string; testID?: string }) {
  return (
    <View style={s.nowRow} testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[s.time, s.nowTime, { width, color: ink }]}>{clock}</Text>
      <View style={s.nowRail}>
        <View style={s.nowLine}><Dots color={line} /></View>
        <View style={s.nowRule} />
        <View style={s.nowDot} />
      </View>
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
const LINE = 1.5;
const TIME = 56;

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
  /** C8 C_fasting's End fast: outlined, forest words on the paper, radius 12, 54 pt (the border colour from the screen). */
  outline: {
    minHeight: layout.buttonHeight, borderRadius: radius.button, borderWidth: 1, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  outlineLabel: { ...typography.bodyMd, fontSize: 16, lineHeight: 22, letterSpacing: 0 },
  /** C2 C_day's eyebrow on the paper: Inter 600 11, tracked 1.3 (.c-e .eb). */
  stopEyebrow: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', lineHeight: 14, letterSpacing: 1.3 },
  /** C2 C_day's done line under a meal's name (.c-e .st 13/1.4, 2 pt under the name). */
  status: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, marginTop: 2 },
  /** C2 C_day's up-next card (.c-next): the drawing's cream card, radius 16, the meal's foods and its button. */
  nextCard: {
    marginTop: 6, paddingTop: spacing.md, paddingHorizontal: 14, paddingBottom: 14, borderRadius: radius.card,
    backgroundColor: colors.cream,
  },
  nextText: { ...typography.bodySmall, lineHeight: 22, color: colors.charcoal },
});

const s = StyleSheet.create({
  // Under the native back bar (the drawings' back row): the eyebrow 8 pt below it (C8 y 149 px, K5 y 196 px).
  mast: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    // C2 C_day: the gold rule 4 pt above the paper, which overlaps the masthead by its radius.
    paddingBottom: spacing.xs + radius.sheet,
  },
  // C8 C_fasting: the paper 21 pt under the title's baseline (y 212 to 243 px at 1.5x).
  mastShort: { paddingBottom: spacing.sm + radius.sheet },
  // K5 C_macros: the masthead's rounded foot (radius 24, y 590-603 px at 2x), the cards on the page below it.
  mastRound: { paddingBottom: spacing.xl, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  // The drawings' eyebrow: Inter 600 11, tracked 1.98 (C_day .ov), in the masthead's light muted ink.
  eyebrow: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: mast.muted, marginBottom: spacing.xs },
  // C_day .h1 (2rem/1.25, Cormorant 500, -0.2) and C8's title (cap 183-212 px at 1.5x = 32 pt).
  title: { ...typography.h1, fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', fontSize: 36, lineHeight: 44, letterSpacing: -0.2, color: mast.ink },
  line: { ...typography.bodySmall, color: mast.ink, marginTop: spacing.sm },
  lineMuted: { color: mast.muted },
  // C_day: 1 pt gold, 12 pt under the summary.
  rule: { height: 1, alignSelf: 'stretch', backgroundColor: mast.rule, marginTop: spacing.md },
  overscroll: { position: 'absolute', left: 0, right: 0, top: -1000, height: 1000 },
  // C_loading / the Food day's DaySkeleton: still blocks on the masthead.
  bone: { borderRadius: radius.button, backgroundColor: lightTokens.data.frameOnDark, opacity: 0.55 },
  boneTitle: { height: 30, width: '70%', marginTop: spacing.sm },
  boneLine: { height: 16, width: '85%', marginTop: 14 },
  // C_day .sum: the marks and the line, Inter 500 15/21, 10 pt under the note.
  progress: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  segs: { flexDirection: 'row', gap: spacing.xs, flexShrink: 0 },
  seg: { width: 16, height: 4, borderRadius: 2, backgroundColor: lightTokens.data.plannedOnDark },
  segDone: { backgroundColor: gold[300] },
  progressLine: { ...typography.bodyMd, fontSize: 15, lineHeight: 21, letterSpacing: 0, color: mast.ink, flexShrink: 1, minWidth: 0 },
  // K5 C_macros' outlined tiles: 56 pt tall (y 362-473 px at 2x), the serif value over a plain Inter label.
  tile: {
    flexGrow: 1, flexBasis: 88, minHeight: 64, borderRadius: radius.input,
    borderWidth: 1, borderColor: lightTokens.data.frameOnDark, paddingHorizontal: spacing.md,
    paddingVertical: 6, justifyContent: 'center',
  },
  tileValue: { ...typography.h2, lineHeight: 28, letterSpacing: 0, color: mast.ink, fontVariant: ['lining-nums'] },
  tileLabel: { ...typography.caption, fontFamily: 'Inter_400Regular', fontWeight: '400', lineHeight: 16, letterSpacing: 0, color: mast.muted },
  // C_day .c-th: the cream tile, 52 pt, radius 12, 10 pt from the words, 2 pt under the row's top.
  art: {
    width: ART, height: ART, borderRadius: radius.input, backgroundColor: colors.cream,
    alignItems: 'center', justifyContent: 'center', marginLeft: 10, marginTop: 2,
  },
  italic: { fontFamily: 'CormorantGaramond_400Regular_Italic', fontWeight: '400' },
  paper: {
    marginTop: -radius.sheet,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: layout.gutter,
    // C8: the ring 20 pt under the paper's top (y 243 to 273 px at 1.5x); C_day's first row 22 pt.
    paddingTop: 20,
    paddingBottom: spacing['3xl'],
    flexGrow: 1,
  },
  tlRow: { flexDirection: 'row' },
  gutter: { width: GUTTER, alignItems: 'center' },
  // The dotted line at the mark's left edge (C_day .c-tl:before at x 62, the mark at 63), 3 pt clear under its
  // mark and on 4 pt into the next row, where the next mark starts: it meets every next mark (LO-927R3 B1).
  tlLine: { position: 'absolute', left: (GUTTER - DOT) / 2 - 1, top: 4 + DOT + 3, bottom: -4, width: LINE },
  // C_day .mk: 14 pt, 1.5 pt ring, 4 pt under the row's top, level with the eyebrow.
  dot: { marginTop: 4, width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5 },
  tlBody: { flex: 1, minWidth: 0, paddingLeft: 6 },
  // C_day .tm: Inter 500 12, right-aligned, 4 pt down; 4 pt to the gutter so the mark sits at the drawn x.
  time: { ...typography.caption, fontFamily: 'Inter_500Medium', fontWeight: '500', fontSize: 12, lineHeight: 16, letterSpacing: 0,
    textAlign: 'right', paddingTop: 4, marginRight: 4 },
  // C_day .c-now: 44 pt, 4 pt up into the row above, 6 pt over the next.
  nowRow: { flexDirection: 'row', alignItems: 'center', minHeight: layout.touchMin, marginTop: -4, marginBottom: 6 },
  nowTime: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', paddingTop: 0 },
  nowRail: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  nowLine: { position: 'absolute', left: (GUTTER - DOT) / 2 - 1, top: 0, bottom: 0, width: LINE },
  nowRule: { height: LINE, marginLeft: (GUTTER - DOT) / 2 - 1, backgroundColor: gold[300] },
  nowDot: { position: 'absolute', left: (GUTTER - DOT) / 2 - 3, top: '50%', marginTop: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: gold[300] },
});
