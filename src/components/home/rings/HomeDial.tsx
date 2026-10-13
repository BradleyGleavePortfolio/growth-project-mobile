/**
 * HomeDial — one of the three Home dials (UI-1 rings and tiles): a 92 pt ring
 * (radius 40, stroke 7, hairline-colour track, forest fill with round caps from
 * 12 o'clock), the serif number and its unit inside, the label and one muted
 * line under it. The whole dial is one button that opens the screen behind it.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { clamp01, type DialView } from './homeRings';

export const DIAL_SIZE = 92;
const R = 40;
const STROKE = 7;
const C = 2 * Math.PI * R;

export interface HomeDialProps {
  label: string;
  view: DialView;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
  /** The centre is a prompt ("Connect"), not a number. */
  prompt?: boolean;
}

export default function HomeDial({ label, view, onPress, accessibilityLabel, testID, prompt }: HomeDialProps) {
  const { semanticColors: sc } = useTheme();
  const fill = clamp01(view.progress) * C;
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        void HapticService.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.dial, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.ring}>
        <Svg width={DIAL_SIZE} height={DIAL_SIZE} viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}>
          <Circle cx={46} cy={46} r={R} fill="none" stroke={sc.border} strokeWidth={STROKE} />
          {fill > 0 ? (
            <Circle
              testID={`${testID}-fill`}
              cx={46} cy={46} r={R} fill="none" stroke={sc.accent} strokeWidth={STROKE}
              strokeLinecap="round" strokeDasharray={`${fill} ${C}`} rotation={-90} origin="46, 46"
            />
          ) : null}
        </Svg>
        <View style={styles.centre} pointerEvents="none">
          <Text
            style={[prompt ? styles.prompt : styles.number, { color: prompt ? sc.accentText : sc.textPrimary }]}
            numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.3}
          >
            {view.value}
          </Text>
          {view.unit ? (
            <Text style={[styles.unit, { color: sc.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{view.unit}</Text>
          ) : null}
        </View>
      </View>
      <Text style={[styles.label, { color: sc.textMuted }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.sub, { color: sc.textMuted }]} numberOfLines={2}>
        {view.sub || ' '}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A third of the row each, so "7 h 20 m asleep" fits on one line at 360 pt; larger text wraps, never clips.
  dial: { width: '33%', alignItems: 'center', minHeight: 44 },
  ring: { width: DIAL_SIZE, height: DIAL_SIZE },
  centre: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  number: { ...typography.h2, fontSize: 25, lineHeight: 32, letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  prompt: { ...typography.bodyMd, fontSize: 14, lineHeight: 20 },
  unit: { ...typography.eyebrow, letterSpacing: 0, textTransform: 'none' },
  label: { ...typography.eyebrow, marginTop: 10 },
  sub: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, marginTop: 4, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
