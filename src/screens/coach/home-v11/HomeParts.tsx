/**
 * The coach Home's parts in Style A (planning/MOCKUP3/HOME3, A; spec #688 6295886580): on the deep hero, the
 * small tiles, the Open alerts row and the day's rings; on the page, the white card and its link rows. Every
 * colour is an existing token (forestPop, the theme); no part draws a number it was not given.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, radius, typography } from '../../../theme/tokens';
import type { RingSpec } from './homeDay';

const RING = 44;
/** Style A sets its figures and titles in Inter (the app loads Inter's 400, 500 and 600). */
export const SEMI = 'Inter_600SemiBold';
const STROKE = 5;

/** A small figure on the hero: the value in leaf, its words under it. */
export function MiniTile({ value, label, testID }: { value: string; label: string; testID?: string }) {
  return (
    <View style={hs.mini} accessible accessibilityLabel={`${value} ${label}`} testID={testID}>
      <Text style={hs.miniValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={hs.miniLabel} numberOfLines={3}>{label}</Text>
    </View>
  );
}

export function AlertsRow({ count, onPress }: { count: number | null; onPress: () => void }) {
  const label = count === null ? 'Open alerts' : `Open alerts, ${count}`;
  return (
    <Pressable style={({ pressed }) => [hs.alerts, pressed && hs.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID="home-alerts">
      <Ionicons name="shield-outline" size={22} color={forestPop.onDeep} />
      <Text style={hs.alertsText}>Open alerts</Text>
      {count !== null ? <Text style={hs.alertsCount}>{count}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={forestPop.onDeepMuted} />
    </Pressable>
  );
}

/** One of the day's rings: gold arc over a quiet track, "done/of" inside. */
export function DayRing({ ring, onPress }: { ring: RingSpec; onPress?: () => void }) {
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const share = ring.of > 0 ? Math.min(1, ring.done / ring.of) : 0;
  const body = (
    <>
      <View style={hs.ringBox}>
        <Svg width={RING} height={RING}>
          <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={forestPop.forest} strokeWidth={STROKE} fill="none" />
          {share > 0 ? (
            <Circle
              cx={RING / 2} cy={RING / 2} r={r} stroke={forestPop.gold} strokeWidth={STROKE} fill="none"
              strokeDasharray={`${c * share} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          ) : null}
        </Svg>
        <Text style={hs.ringValue} numberOfLines={1}>{ring.done}/{ring.of}</Text>
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
  const { colors, semanticColors: sem } = useTheme();
  return React.useMemo(() => StyleSheet.create({
    card: { backgroundColor: sem.bgSurface, borderRadius: radius.card + 2, borderWidth: StyleSheet.hairlineWidth, borderColor: sem.border, padding: 18 },
    title: { fontFamily: SEMI, fontSize: 18, lineHeight: 24, color: colors.textPrimary },
    body: { ...typography.body, color: colors.textPrimary },
    muted: { ...typography.bodySmall, color: colors.textMuted },
    strong: { ...typography.bodyMd, color: colors.textPrimary },
    section: { ...typography.caption, fontFamily: SEMI, letterSpacing: 1.4, color: colors.textMuted, marginTop: 10, marginBottom: 2 },
    row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18, gap: 12 },
    rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sem.border },
    rowText: { flex: 1, minWidth: 0 },
    rowCount: { fontFamily: SEMI, fontSize: 20, lineHeight: 26, color: colors.textPrimary },
    pressed: { opacity: 0.7 },
  }), [colors, sem]);
}

/** A row in the Clients card: a title, an optional line under it, an optional count, and a chevron. */
export function LinkRow({ title, line, count, first, onPress, testID }: {
  title: string; line?: string | null; count?: number | null; first?: boolean; onPress: () => void; testID: string;
}) {
  const s = useCardStyles();
  const { colors } = useTheme();
  const label = [title, line, count != null ? String(count) : null].filter(Boolean).join(', ');
  return (
    <Pressable style={({ pressed }) => [s.row, !first && s.rowLine, pressed && s.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <View style={s.rowText}>
        <Text style={s.strong} numberOfLines={1}>{title}</Text>
        {line ? <Text style={s.muted} numberOfLines={1}>{line}</Text> : null}
      </View>
      {count != null ? <Text style={s.rowCount}>{count}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const hs = StyleSheet.create({
  mini: { flex: 1, minWidth: 0, backgroundColor: forestPop.forest, borderRadius: radius.button + 2, paddingVertical: 8, paddingHorizontal: 12 },
  miniValue: { fontFamily: SEMI, fontSize: 22, lineHeight: 28, color: forestPop.leaf },
  miniLabel: { ...typography.bodySmall, color: forestPop.onDeepMuted },
  alerts: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: forestPop.brand400, borderRadius: radius.button + 2, paddingHorizontal: 18 },
  alertsText: { ...typography.bodyMd, fontSize: 18, color: forestPop.onDeep, flex: 1 },
  alertsCount: { fontFamily: SEMI, fontSize: 24, lineHeight: 30, color: forestPop.onDeep },
  ring: { flex: 1, alignItems: 'center', minHeight: 44, paddingVertical: 2 },
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringValue: { ...typography.bodySmall, fontFamily: SEMI, color: forestPop.onDeep, position: 'absolute' },
  ringLabel: { ...typography.caption, fontFamily: SEMI, letterSpacing: 0.6, color: forestPop.gold, marginTop: 2 },
  pressed: { opacity: 0.7 },
});
