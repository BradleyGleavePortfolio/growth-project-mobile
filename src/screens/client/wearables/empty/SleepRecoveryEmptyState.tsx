/**
 * SleepRecoveryEmptyState — shown when the user has no S&R data yet. Per
 * Bradley LAW it is the SKELETON OF THE REAL LAYOUT (a recovery-ring outline +
 * card placeholders) with a value-first prompt + Connect CTA — NEVER a spinner,
 * NEVER a placeholder/not-yet-built message.
 *
 * Copy is reassurance-first (UX gate §5.6): "Connect a tracker and we'll show
 * your recovery story."
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { RECOVERY_PALETTE } from '../recoveryTheme';

export interface SleepRecoveryEmptyStateProps {
  colors: ThemeColors;
  /** Navigates to the Connections hub. Required — the CTA must do something. */
  onConnect: () => void;
  testID?: string;
}

export function SleepRecoveryEmptyState({ colors, onConnect, testID }: SleepRecoveryEmptyStateProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const size = 200;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;

  return (
    <View style={styles.wrap} testID={testID ?? 'sleep-recovery-empty'}>
      {/* Skeleton of the real ring hero — outline only, no value. */}
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={RECOVERY_PALETTE.track}
            strokeWidth={strokeWidth}
            fill="none"
          />
        </Svg>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.ringCenter}>
            <Ionicons name="moon-outline" size={40} color={RECOVERY_PALETTE.accentMuted} />
          </View>
        </View>
      </View>

      <Text style={styles.title}>Connect a tracker and we&apos;ll show your recovery story.</Text>
      <Text style={styles.subtitle}>
        Sleep stages, heart-rate variability and overnight breathing — all in one calm view.
      </Text>

      {/* Skeleton card placeholders below the ring. */}
      <View style={styles.skeletonCard} />
      <View style={styles.skeletonCard} />

      <TouchableOpacity
        style={styles.cta}
        onPress={onConnect}
        accessibilityRole="button"
        accessibilityLabel="Connect a tracker"
        testID="sleep-recovery-empty-cta"
      >
        <Text style={styles.ctaText}>Connect a tracker</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, gap: 12 },
    ringCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textPrimary,
      textAlign: 'center',
      marginTop: 8,
    },
    subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
    skeletonCard: {
      width: '100%',
      height: 72,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cta: {
      marginTop: 8,
      backgroundColor: RECOVERY_PALETTE.accent,
      paddingVertical: 14,
      paddingHorizontal: 32,
      borderRadius: 12,
      alignSelf: 'stretch',
      alignItems: 'center',
    },
    ctaText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15, letterSpacing: 0.3 },
  });
}

export default SleepRecoveryEmptyState;
