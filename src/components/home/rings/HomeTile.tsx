/**
 * HomeTile — one Home tile (UI-1 rings and tiles): radius 16 surface with a
 * hairline, the label, a serif value with its muted unit, an optional bar or
 * extra (sparkline), and muted foot lines. The tile is one button with a
 * selection haptic; an accessory (the water chip) sits beside it as its own button.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import type { TileView } from './homeTiles';

export interface HomeTileProps {
  label: string;
  view: TileView;
  onPress: () => void;
  testID: string;
  /** The value is a prompt ("Connect"), not a number. */
  prompt?: boolean;
  children?: React.ReactNode;
  accessory?: React.ReactNode;
}

export default function HomeTile({ label, view, onPress, testID, prompt, children, accessory }: HomeTileProps) {
  const { semanticColors: sc } = useTheme();
  const spoken = [label, [view.value, view.small].filter(Boolean).join(' '), view.sub.replace(/\n/g, ', ')].filter(Boolean).join(', ');
  return (
    <View style={[styles.tile, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
      <Pressable
        testID={testID}
        onPress={() => {
          void HapticService.selection();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        style={({ pressed }) => [styles.main, accessory ? styles.mainWithAccessory : null, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[typography.eyebrow, { color: sc.textMuted }]} numberOfLines={1}>{label}</Text>
        <Text style={[prompt ? styles.prompt : styles.value, { color: prompt ? sc.accentText : sc.textPrimary }]}
          numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.3}>
          {view.value}
          {view.small ? <Text style={[styles.small, { color: sc.textMuted }]}>{` ${view.small}`}</Text> : null}
        </Text>
        {view.progress !== null ? (
          <View style={[styles.bar, { backgroundColor: sc.border }]}>
            <View testID={`${testID}-bar`} style={[styles.fill, { backgroundColor: sc.accent, width: `${Math.round(view.progress * 100)}%` }]} />
          </View>
        ) : null}
        {children}
        {view.sub ? <Text style={[styles.sub, { color: sc.textMuted }]}>{view.sub}</Text> : null}
      </Pressable>
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, minHeight: 118, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  main: { flexGrow: 1, padding: 14 },
  mainWithAccessory: { paddingBottom: 8 },
  value: { ...typography.h2, fontSize: 26, lineHeight: 33, letterSpacing: 0.3, marginTop: 8, fontVariant: ['tabular-nums'] },
  small: { ...typography.bodySmall, fontSize: 14, lineHeight: 18, letterSpacing: 0 },
  prompt: { ...typography.bodyMd, fontSize: 15, lineHeight: 22, marginTop: 12 },
  bar: { height: 4, borderRadius: radius.chip, marginTop: 10, overflow: 'hidden' },
  fill: { height: 4, borderRadius: radius.chip },
  sub: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, marginTop: 'auto', paddingTop: 6 },
  accessory: { paddingHorizontal: 14, paddingBottom: 14 },
});
