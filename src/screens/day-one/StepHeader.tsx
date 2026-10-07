/**
 * StepHeader — back arrow + linear progress bar shared across Day-1 screens.
 *
 * The progress bar animates between steps unless the user has Reduce Motion
 * enabled (then it snaps). Accessibility: announces "Step N of M" so VoiceOver
 * users hear where they are in the flow.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { t } from './i18n/strings';

export const DAY_ONE_TOTAL_STEPS = 6;

/** Shared semantic palette; the provider's legacy flat colors are fixed light. */
export function useDayOneColors() {
  const { semanticColors: sc } = useTheme();
  return {
    background: sc.bgPrimary, primary: sc.accent, textOnPrimary: sc.textOnAccent,
    textPrimary: sc.textPrimary, textSecondary: sc.textMuted, textMuted: sc.textMuted,
    border: sc.border, error: sc.textPrimary, noticeCriticalText: sc.textPrimary,
    noticeCriticalAccent: sc.accentText,
  };
}
export type DayOneColors = ReturnType<typeof useDayOneColors>;

interface Props {
  /** 1-indexed current step. Pass 0 to hide both bar and back button (Welcome). */
  step: number;
  onBack?: () => void;
}

export default function StepHeader({ step, onBack }: Props) {
  const colors = useDayOneColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const target = Math.max(0, Math.min(step, DAY_ONE_TOTAL_STEPS)) / DAY_ONE_TOTAL_STEPS;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setReduceMotion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(target);
      return;
    }
    Animated.timing(progress, {
      toValue: target,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, [target, reduceMotion, progress]);

  if (step <= 0) return null;

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={styles.wrap}
      accessibilityRole="header"
      accessibilityLabel={t('common.progressLabel', {
        current: step,
        total: DAY_ONE_TOTAL_STEPS,
      })}
    >
      <View style={styles.row}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            testID="day-one-back"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
        <View style={styles.spacer} />
        <Text style={styles.stepText} testID="day-one-step-text">
          {t('common.progressLabel', { current: step, total: DAY_ONE_TOTAL_STEPS })}
        </Text>
      </View>
      <View style={styles.track} testID="day-one-progress-track">
        <Animated.View style={[styles.fill, { width }]} testID="day-one-progress-fill" />
      </View>
    </View>
  );
}

const makeStyles = (colors: DayOneColors) =>
  StyleSheet.create({
    wrap: {
      paddingHorizontal: 24,
      paddingTop: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      marginBottom: 8,
    },
    backBtn: {
      width: 44,
      height: 44,
      justifyContent: 'center',
      alignItems: 'flex-start',
    },
    spacer: { flex: 1 },
    stepText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      fontVariant: ['tabular-nums'],
      color: colors.textMuted,
    },
    track: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      backgroundColor: colors.primary,
    },
  });
