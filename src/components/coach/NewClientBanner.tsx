/**
 * NewClientBanner — post-Stripe-return detection banner.
 *
 * On AppState background → active transition:
 *   1. Read MMKV 'coach.stripe_was_unconfigured' ('true'/'false')
 *   2. If was unconfigured: call coachConnectApi.getStatus()
 *   3. If now configured === true: show one-time banner
 *   4. Write 'coach.stripe_was_unconfigured' = 'false'
 *
 * Banner auto-dismisses after 4s, or earlier on tap.
 * Position is relative (not absolute) — inline in the ScrollView flow.
 */

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, AppStateStatus } from 'react-native';
import { coachConnectApi } from '../../api/coachConnectApi';
import { prefsStorage } from '../../storage/mmkv';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

const WAS_UNCONFIGURED_KEY = 'coach.stripe_was_unconfigured';
const AUTO_DISMISS_MS = 4000;

export default function NewClientBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [visible, setVisible] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setVisible(false);
  }, []);

  const showBanner = useCallback(() => {
    setVisible(true);
    dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
  }, [dismiss]);

  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      try {
        const wasUnconfigured = await prefsStorage.getStringAsync(WAS_UNCONFIGURED_KEY);
        if (wasUnconfigured !== 'true') return;

        // Mark checked immediately to avoid double-showing on rapid foregrounds
        await prefsStorage.set(WAS_UNCONFIGURED_KEY, 'false');

        const result = await coachConnectApi.getStatus();
        if (result.ok && result.data.configured) {
          showBanner();
        }
      } catch {
        // Fail-silent — banner is supplemental, never block
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [showBanner]);

  if (!visible) return null;

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={dismiss}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Stripe connected. Dismiss this notice."
      testID="new-client-banner"
    >
      <Text style={styles.bannerText}>Stripe connected. You can now publish packages.</Text>
      <Text style={styles.dismissText}>×</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 24,
      marginBottom: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderWidth: 1,
      borderRadius: 2,
      borderColor: colors.primary,
      backgroundColor: colors.background,
    },
    bannerText: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textPrimary,
      lineHeight: 20,
    },
    dismissText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 18,
      color: colors.textMuted,
      lineHeight: 20,
      paddingLeft: 12,
    },
  });
