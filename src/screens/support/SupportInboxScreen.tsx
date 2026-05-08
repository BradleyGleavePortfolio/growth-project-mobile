/**
 * SupportInboxScreen.tsx — In-app support inbox powered by Crisp Chat.
 *
 * Accessible from Settings -> Support for both client and coach users.
 *
 * The screen opens the Crisp chat widget using the native `show()` function
 * from `crisp-sdk-react-native`. Because the SDK overlays the chat on top of
 * the current view hierarchy this screen acts as the navigable entry point
 * that initialises the SDK and triggers the overlay.
 *
 * NOTE: This screen requires a development build. The Crisp native SDK is
 * not available in Expo Go. See docs/support-inbox.md for details.
 *
 * Design follows the bone/ink/forest palette and theme tokens from
 * ThemeProvider. No hardcoded colors. No emoji.
 */

import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { show } from 'crisp-sdk-react-native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

interface Props {
  navigation: NavigationProp<ParamListBase>;
}

export default function SupportInboxScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    // Open the Crisp chat overlay as soon as the screen mounts.
    // The overlay sits above the current React Native view hierarchy;
    // the user dismisses it via the Crisp UI and returns to this screen.
    try {
      show();
    } catch (err) {
      // If the native module is unavailable (e.g. running in Expo Go or
      // EXPO_PUBLIC_CRISP_WEBSITE_ID is not set) the overlay silently
      // fails and the fallback UI below is shown instead.
      if (__DEV__) {
        console.warn('[SupportInboxScreen] crisp-sdk-react-native show() failed:', err);
      }
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.topBar}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.topTitle} accessibilityRole="header">
          Support
        </Text>
        <View style={styles.backBtn} />
      </View>

      {/* Body — shown while the SDK overlay is loading or as fallback */}
      <View style={styles.body}>
        <View style={styles.iconWrapper}>
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={48}
            color={colors.primary}
          />
        </View>
        <Text style={styles.heading}>Live Support</Text>
        <Text style={styles.body_text}>
          Connect with our support team via the chat overlay. The window
          should open automatically. If it did not appear, tap the button
          below.
        </Text>
        <HapticPressable
          intent="medium"
          style={styles.openBtn}
          onPress={() => {
            try {
              show();
            } catch {
              // silent — handled by fallback message below
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Open support chat"
          accessibilityHint="Opens the Crisp live support chat overlay"
        >
          <Text style={styles.openBtnText}>Open Support Chat</Text>
        </HapticPressable>

        <Text style={styles.note}>
          Support is separate from Coach AI and the Client Bot. A human
          operator will respond during business hours.
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: {
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      paddingBottom: 48,
      gap: 16,
    },
    iconWrapper: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    heading: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    body_text: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    openBtn: {
      backgroundColor: colors.primary,
      borderRadius: 4,
      paddingVertical: 14,
      paddingHorizontal: 32,
      alignItems: 'center',
      marginTop: 8,
    },
    openBtnText: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.textOnPrimary,
    },
    note: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 19,
      marginTop: 16,
      paddingHorizontal: 8,
    },
  });
}
