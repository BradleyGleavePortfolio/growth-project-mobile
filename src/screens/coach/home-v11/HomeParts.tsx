/**
 * The coach Home's parts in Style A (planning/MOCKUP3/HOME3, A; spec #688 6295886580): on the deep hero, the
 * small tiles, the Open alerts row and the day's rings; on the page, the white card and its link rows. Style A's own
 * values live in `styleA` below, local to this screen (tokens.ts is app-wide); no part draws a number it was not given.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors as brand, forestPop, radius, typography } from '../../../theme/tokens';
import type { RingSpec } from './homeDay';

const RING = 44;
/** Style A sets its figures and titles in Inter (the app loads Inter's 400, 500 and 600). */
export const SEMI = 'Inter_600SemiBold';
const STROKE = 5;

/** Style A's values for this screen only (planning/MOCKUP3/HOME3/src/a.py on op161/ui2a-remake; m#863 G5 to G24). */
export const styleA = {
  deep2: '#26402F', // the small tiles on deep
  onDeep: '#F4F7F2', // text and icons on deep
  figure: '#FFFFFF', // the big figure and the ring fractions
  line: '#4A6553', // the outline on deep: Open alerts at zero, Try again
  track: '#3A5443', // the ring and bar tracks
  card: '#FFFFFF', // the page cards and the open alerts row
  cardLine: '#DCE3DB', // the card edge and the line between rows
  ink: '#142019', // text on the open alerts row
  inkMuted: '#4F5D54', // chevrons on white (A `.mut`)
  checkLine: '#8A988E', // the open tick circle on white (A `.ck`)
  grey: brand.graphite, // small grey text on a light ground: #2C2C2C (owner #168-13, after the mockups, wins over A's #4F5D54)
} as const;

/** The small capitals over a block: the date, YOUR DAY, ACTIVE TODAY, BUSINESS, CLIENTS (Style A `.eb`, `.sec`). */
export const EYEBROW = { fontFamily: SEMI, fontSize: 11, lineHeight: 14, letterSpacing: 1.6 } as const;

/** Style A's card lift, 0 2px 10px rgba(20,32,25,.05). */
const CARD_SHADOW = { shadowColor: styleA.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 } as const;

/** Style A's white card (`.card`), light scheme: also drawn by the setup checklist, the push ask and the brief on this Home. */
export const CARD_A = { backgroundColor: styleA.card, borderRadius: radius.card, borderWidth: 0.5, borderColor: styleA.cardLine, ...CARD_SHADOW } as const;

/** A small figure on the hero: the value in leaf, its words under it. */
export function MiniTile({ value, label, testID }: { value: string; label: string; testID?: string }) {
  return (
    <View style={hs.mini} accessible accessibilityLabel={`${value} ${label}`} testID={testID}>
      <Text style={hs.miniValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={hs.miniLabel} numberOfLines={3}>{label}</Text>
    </View>
  );
}

/** Style A's shield with its mark (lib.py `ic('shield')`, 24 pt): the app's shield outline, the mark drawn inside it. */
function AlertShield({ color }: { color: string }) {
  return (
    <View style={hs.shield} testID="home-alerts-shield">
      <Ionicons name="shield-outline" size={24} color={color} />
      <View style={[hs.shieldBar, { backgroundColor: color }]} />
      <View style={[hs.shieldDot, { backgroundColor: color }]} />
    </View>
  );
}

/** Open alerts: an outline on deep at zero; white with the red count and shield, and "Waiting in Actions", when any are open. */
export function AlertsRow({ count, onPress }: { count: number | null; onPress: () => void }) {
  const open = count !== null && count > 0;
  // A screen reader hears what the row shows, its second line too.
  const label = count === null ? 'Open alerts' : `Open alerts, ${count}${open ? ', Waiting in Actions' : ''}`;
  return (
    <Pressable style={({ pressed }) => [hs.alerts, open && hs.alertsOpen, pressed && hs.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID="home-alerts">
      <AlertShield color={open ? forestPop.error : forestPop.onDeepMuted} />
      <View style={hs.grow}>
        <Text style={[hs.alertsText, open && hs.onWhite]}>Open alerts</Text>
        {open ? <Text style={hs.alertsWaiting} testID="home-alerts-waiting">Waiting in Actions</Text> : null}
      </View>
      {count !== null ? <Text style={[hs.alertsCount, open && hs.alertsCountOpen]}>{count}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={open ? styleA.inkMuted : forestPop.onDeepMuted} />
    </Pressable>
  );
}

/** One of the day's rings: gold arc over a quiet track, "done/of" inside, shrunk to fit the ring and never scaled up. */
export function DayRing({ ring, onPress }: { ring: RingSpec; onPress?: () => void }) {
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const share = ring.of > 0 ? Math.min(1, ring.done / ring.of) : 0;
  const body = (
    <>
      <View style={hs.ringBox}>
        <Svg width={RING} height={RING}>
          <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={styleA.track} strokeWidth={STROKE} fill="none" />
          {share > 0 ? (
            <Circle
              cx={RING / 2} cy={RING / 2} r={r} stroke={forestPop.gold} strokeWidth={STROKE} fill="none"
              strokeDasharray={`${c * share} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          ) : null}
        </Svg>
        <Text style={hs.ringValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} maxFontSizeMultiplier={1}>{`${ring.done}/${ring.of}`}</Text>
      </View>
      <Text style={hs.ringLabel} numberOfLines={1} maxFontSizeMultiplier={1.15}>{ring.label.toUpperCase()}</Text>
    </>
  );
  const label = `${ring.label}, ${ring.done} of ${ring.of}`;
  return onPress ? (
    <Pressable style={({ pressed }) => [hs.ring, pressed && hs.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={`home-ring-${ring.key}`}>
      {body}
    </Pressable>
  ) : (
    <View style={hs.ring} accessible accessibilityLabel={label} testID={`home-ring-${ring.key}`}>{body}</View>
  );
}

export function useCardStyles() {
  const { colors, semanticColors: sem, colorScheme } = useTheme();
  const light = colorScheme !== 'dark'; // Style A's white card is a light-scheme value; a dark scheme keeps the theme's
  return React.useMemo(() => StyleSheet.create({
    card: { ...CARD_A, ...(light ? null : { backgroundColor: sem.bgSurface, borderColor: sem.border }), paddingVertical: 18, paddingHorizontal: 16 },
    title: { fontFamily: SEMI, fontSize: 16, lineHeight: 21, color: colors.textPrimary },
    body: { ...typography.body, color: colors.textPrimary },
    // A `.ls`, the small lines in Business and Clients: graphite #2C2C2C on a light ground (owner #168-13, m#875).
    muted: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: light ? styleA.grey : colors.textMuted },
    strong: { ...typography.bodyMd, color: colors.textPrimary },
    // A `.sec`: 22 above (the page's gap of 10 plus 12) and 8 below.
    section: { ...EYEBROW, color: light ? styleA.grey : colors.textMuted, marginTop: 12, marginBottom: 8 },
    row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, gap: 12 }, // A `.lrow`
    rowLine: { borderTopWidth: 0.5, borderTopColor: light ? styleA.cardLine : sem.border },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 20, color: light ? styleA.ink : colors.textPrimary }, // A `.lt`
    rowCount: { fontFamily: SEMI, fontSize: 18, lineHeight: 22, color: light ? forestPop.forest : colors.textPrimary }, // A `.lv`
    chevron: { color: light ? styleA.inkMuted : colors.textMuted }, // A `.mut` on the white cards
    pressed: { opacity: 0.7 },
  }), [colors, sem, light]);
}

/** A row in the Clients card: a title, an optional line under it, an optional count, and a chevron. */
export function LinkRow({ title, line, count, first, onPress, testID }: {
  title: string; line?: string | null; count?: number | null; first?: boolean; onPress: () => void; testID: string;
}) {
  const s = useCardStyles();
  const label = [title, line, count != null ? String(count) : null].filter(Boolean).join(', ');
  return (
    <Pressable style={({ pressed }) => [s.row, !first && s.rowLine, pressed && s.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <View style={s.rowText}>
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        {line ? <Text style={s.muted} numberOfLines={1}>{line}</Text> : null}
      </View>
      {count != null ? <Text style={s.rowCount}>{count}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={s.chevron.color} />
    </Pressable>
  );
}

const hs = StyleSheet.create({
  mini: { flex: 1, minWidth: 0, minHeight: 44, backgroundColor: styleA.deep2, borderRadius: radius.button, paddingVertical: 6, paddingHorizontal: 12 },
  miniValue: { fontFamily: SEMI, fontSize: 20, lineHeight: 24, color: forestPop.leaf },
  miniLabel: { ...typography.bodySmall, fontSize: 12.5, lineHeight: 17, color: forestPop.onDeepMuted },
  alerts: {
    minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: styleA.line, borderRadius: radius.button,
    paddingVertical: 6, paddingHorizontal: 12,
  },
  alertsOpen: { backgroundColor: styleA.card, borderColor: styleA.card },
  shield: { width: 24, height: 24 },
  shieldBar: { position: 'absolute', left: 11.2, top: 7.2, width: 1.6, height: 6.6, borderRadius: 0.8 }, // the mark's line, y 8 to 13
  shieldDot: { position: 'absolute', left: 11.2, top: 15.2, width: 1.6, height: 1.8, borderRadius: 0.8 }, // and its dot at y 16
  grow: { flex: 1, minWidth: 0 },
  alertsText: { fontFamily: SEMI, fontSize: 15, lineHeight: 20, color: styleA.onDeep },
  onWhite: { color: styleA.ink },
  alertsWaiting: { ...typography.bodySmall, fontSize: 13, lineHeight: 17, color: styleA.grey },
  alertsCount: { fontFamily: SEMI, fontSize: 22, lineHeight: 26, color: styleA.onDeep },
  alertsCountOpen: { color: forestPop.error },
  ring: { flex: 1, alignItems: 'center', minHeight: 44, paddingVertical: 2 },
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringValue: { ...typography.bodySmall, fontFamily: SEMI, color: styleA.figure, position: 'absolute', width: RING - 2 * STROKE, textAlign: 'center' }, // 112/140 shrinks to fit (LO B2)
  ringLabel: { ...typography.caption, fontFamily: SEMI, letterSpacing: 0.6, color: forestPop.gold, marginTop: 2 },
  pressed: { opacity: 0.7 },
});
