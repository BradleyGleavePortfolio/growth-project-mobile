/**
 * UI-2 (V1_1_UI_SPEC, owner 10-09 "render 2"): the pieces of the coach Home, to the mockup in
 * tgp-agent-context planning/v1_1_ui/ui-2-coach-home. Theme colours, type and radius tokens only;
 * serif lineHeight >= 1.25 x fontSize.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, radius, typography } from '../../../theme/tokens';
import { QuietOverline } from '../../../ui';
import MonogramBadge from '../../../components/community/coach/MonogramBadge';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { FIGURES } from '../command-center/CoachHomeSections';

const SIZE = 92;
const R = 40;
const STROKE = 7;
const CIRC = 2 * Math.PI * R;

export interface DialSpec { key: string; value: string; unit: string; label: string; sub?: string; progress: number }

/** One ring: track in the hairline colour, forest fill with round caps from 12 o'clock, the number in its middle. */
export function HomeDial({ value, unit, label, sub, progress, testID }: DialSpec & { testID: string }) {
  const { semanticColors: sc } = useTheme();
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <View style={styles.dial} accessible accessibilityLabel={[`${label}: ${value} ${unit}`, sub].filter(Boolean).join('. ')} testID={testID}>
      <View style={styles.ring}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={sc.border} strokeWidth={STROKE} />
          {p > 0 ? (
            <Circle
              cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={sc.accent} strokeWidth={STROKE} strokeLinecap="round"
              strokeDasharray={`${CIRC * p} ${CIRC}`} rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`} testID={`${testID}-fill`}
            />
          ) : null}
        </Svg>
        <View style={styles.ringCenter} pointerEvents="none">
          <Text style={[styles.dialValue, { color: sc.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{value}</Text>
          <Text style={[styles.dialUnit, { color: sc.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{unit}</Text>
        </View>
      </View>
      <QuietOverline style={styles.dialLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</QuietOverline>
      {sub ? <Text style={[styles.dialSub, { color: sc.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{sub}</Text> : null}
    </View>
  );
}

/** A client who needs the coach: monogram, name, last activity, the server's reason in a cream pill. */
export function ClientTile({ name, line, reason, width, onPress, testID }: {
  name: string; line: string | null; reason: string; width: number; onPress: () => void; testID: string;
}) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      onPress={() => { void HapticService.softImpact(); onPress(); }}
      accessibilityRole="button" accessibilityLabel={[name, line, reason].filter(Boolean).join('. ')} testID={testID}
      style={({ pressed }) => [styles.tile, { width, backgroundColor: sc.bgSurface, borderColor: sc.border }, pressed && styles.pressed]}
    >
      <MonogramBadge name={name} size={36} />
      <Text style={[styles.tileName, { color: sc.textPrimary }]} numberOfLines={1}>{name}</Text>
      {line ? <Text style={[styles.tileLine, { color: sc.textMuted }]} numberOfLines={2}>{line}</Text> : null}
      <View style={styles.why}>
        <Text style={[styles.pill, { color: colors.ink }]} numberOfLines={1}>{reason}</Text>
      </View>
    </Pressable>
  );
}

/** The dashed last tile: the whole roster, opens Clients. */
export function AllClientsTile({ count, width, onPress }: { count: number; width: number; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      onPress={() => { void HapticService.softImpact(); onPress(); }}
      accessibilityRole="button" accessibilityLabel={`All ${count} clients. Open Clients`} testID="coach-home-v11-all-clients"
      style={({ pressed }) => [styles.tile, styles.dashed, { width }, pressed && styles.pressed]}
    >
      <Text style={[styles.tileName, styles.flushTop, { color: sc.textPrimary }]} numberOfLines={2}>{`All ${count} clients`}</Text>
      <Text style={[styles.link, { color: sc.accentText }]}>Open Clients</Text>
    </Pressable>
  );
}

/** A Business figure: small-caps label, serif number, muted line; opens Money. */
export function BusinessTile({ label, value, sub, width, onPress, testID }: {
  label: string; value: string; sub: string; width: number; onPress: () => void; testID: string;
}) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      onPress={() => { void HapticService.softImpact(); onPress(); }}
      accessibilityRole="button" accessibilityLabel={`${label}: ${value}. ${sub}`} testID={testID}
      style={({ pressed }) => [styles.tile, styles.business, { width, backgroundColor: sc.bgSurface, borderColor: sc.border }, pressed && styles.pressed]}
    >
      <QuietOverline style={styles.flat} numberOfLines={1}>{label}</QuietOverline>
      <Text style={[styles.bizValue, { color: sc.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{value}</Text>
      <Text style={[styles.tileLine, styles.bottom, { color: sc.textMuted }]} numberOfLines={2}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dial: { width: '31%', alignItems: 'center' },
  ring: { width: SIZE, height: SIZE },
  ringCenter: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  dialValue: { ...typography.h2, fontSize: 25, lineHeight: 32, letterSpacing: 0.3, fontVariant: FIGURES },
  dialUnit: { ...typography.caption, fontSize: 11, lineHeight: 13, letterSpacing: 0 },
  dialLabel: { marginTop: 10, marginBottom: 0, textAlign: 'center' },
  dialSub: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, marginTop: 4, textAlign: 'center' },
  tile: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: 14, minHeight: 132 },
  dashed: { borderStyle: 'dashed', borderWidth: 1, borderColor: colors.stone, justifyContent: 'space-between' },
  business: { minHeight: 118 },
  tileName: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, marginTop: 10 },
  flushTop: { marginTop: 0 },
  tileLine: { ...typography.bodySmall, fontSize: 13, lineHeight: 18 },
  why: { marginTop: 'auto', paddingTop: 10, alignItems: 'flex-start' },
  pill: { ...typography.caption, letterSpacing: 0, lineHeight: 16, overflow: 'hidden', backgroundColor: colors.cream, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 5 },
  link: { ...typography.bodyMd, fontSize: 15, lineHeight: 22 },
  flat: { marginBottom: 0 },
  bizValue: { ...typography.h2, fontSize: 26, lineHeight: 33, letterSpacing: 0.3, marginTop: 8, fontVariant: FIGURES },
  bottom: { marginTop: 'auto', paddingTop: 6 },
  pressed: { opacity: 0.6 },
});
