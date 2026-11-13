// Slim "you're offline" banner shown at the top of the root navigator.
// Only renders when NetInfo reports the device is disconnected OR the internet
// is explicitly unreachable. A null reachability value is treated as online to
// avoid false positives during the first few hundred ms of app launch.

import React from 'react';
import { View, Text, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStatus, isEffectivelyOnline } from '../hooks/useNetworkStatus';
import { Colors } from '../constants/colors';
import { colors, layout } from '../theme/tokens';
import { readUserCacheSync } from '../lib/userCache';
import { isCoachLikeRole } from '../lib/roleSelectionGate';

// C1-S-10 (MOCK-C1 index.md:245, drawn in C1 Style C v2 C2_offline_*; WORKOUT-SUMMARY-M): workouts are queued on the
// phone too (the whole-workout queue), so a client is told both are safe.
const CLIENT_LINE = 'You are offline. Workouts and food logs are saved on this phone and sync when you reconnect.';
// FIN-868R5 C6: a coach has no food logs, and nothing of theirs waits to sync.
// Opens as the K2 offline banner and the inbox's offline card do.
const COACH_LINE = 'You are offline. Reconnect to see the latest.';

export default function OfflineBanner() {
  const status = useNetworkStatus();
  if (isEffectivelyOnline(status)) return null;
  // Read when the banner shows, which is when the network changes.
  const coach = isCoachLikeRole(readUserCacheSync()?.role);

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={16} color={Colors.textOnPrimary} />
      <Text style={styles.text} maxFontSizeMultiplier={1.3}>{coach ? COACH_LINE : CLIENT_LINE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // C2_offline: a dark ink band under the status bar, the icon and up to two lines, left aligned.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.ink,
    paddingVertical: 10,
    paddingHorizontal: layout.gutter,
    // Sit below the status bar on Android; iOS is handled by the SafeAreaView in
    // the root navigator so this only adds its own vertical padding.
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 10 : 10,
  },
  text: {
    flex: 1,
    color: Colors.textOnPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
