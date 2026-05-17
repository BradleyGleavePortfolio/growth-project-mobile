/**
 * StripeSetupBanner — non-blocking banner prompting the coach to connect Stripe.
 *
 * Rules:
 * - MMKV key 'coach.stripe_banner_dismissed' — if 'true', render null
 * - On mount: GET /coach/connect/status via coachConnectApi.getStatus()
 * - If configured === false: show banner
 * - API error → suppress (fail-silent, never crash)
 * - Dismiss (×) → writes MMKV key, unmounts
 * - Tap body → navigate to Billing (SettingsStack > Billing)
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { coachConnectApi } from '../../api/coachConnectApi';
import { prefsStorage } from '../../storage/mmkv';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

const DISMISSED_KEY = 'coach.stripe_banner_dismissed';

export default function StripeSetupBanner() {
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Check MMKV dismissed flag first
      try {
        const dismissed = await prefsStorage.getStringAsync(DISMISSED_KEY);
        if (dismissed === 'true') return;
      } catch {
        // if MMKV read fails, continue — prefer to show than suppress
      }

      // Check Stripe connection status
      try {
        const result = await coachConnectApi.getStatus();
        if (!cancelled && result.ok && !result.data.configured) {
          setVisible(true);
        }
        // If result.ok===false (not_configured 404) or already configured → suppress
      } catch {
        // Network error → suppress banner, never crash
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = useCallback(() => {
    prefsStorage.set(DISMISSED_KEY, 'true').catch(() => {});
    setVisible(false);
  }, []);

  const handlePress = useCallback(() => {
    navigation.navigate('SettingsStack', { screen: 'Billing' } as never);
  }, [navigation]);

  if (!visible) return null;

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Connect Stripe to start accepting payments"
      testID="stripe-setup-banner"
    >
      <Text style={styles.bannerText}>Connect Stripe to start accepting payments.</Text>
      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={handleDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss Stripe banner"
        testID="stripe-banner-dismiss"
      >
        <Text style={styles.dismissText}>×</Text>
      </TouchableOpacity>
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
    dismissBtn: {
      paddingLeft: 12,
    },
    dismissText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 18,
      color: colors.textMuted,
      lineHeight: 20,
    },
  });
