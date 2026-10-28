// Slim "you're offline" banner shown at the top of the root navigator.
// Only renders when NetInfo reports the device is disconnected OR the internet
// is explicitly unreachable. A null reachability value is treated as online to
// avoid false positives during the first few hundred ms of app launch.

import React from 'react';
import { View, Text, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStatus, isEffectivelyOnline } from '../hooks/useNetworkStatus';
import { Colors } from '../constants/colors';
import { readUserCacheSync } from '../lib/userCache';
import { isCoachLikeRole } from '../lib/roleSelectionGate';

const CLIENT_LINE = "You're offline — food logs will sync when you reconnect.";
// FIN-868R5 C6: a coach has no food logs, and nothing of theirs waits to sync.
const COACH_LINE = "You're offline — reconnect to load the latest.";

export default function OfflineBanner() {
  const status = useNetworkStatus();
  if (isEffectivelyOnline(status)) return null;
  // Read when the banner shows, which is when the network changes.
  const coach = isCoachLikeRole(readUserCacheSync()?.role);

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={14} color={Colors.textOnPrimary} />
      <Text style={styles.text}>{coach ? COACH_LINE : CLIENT_LINE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.offlineBanner,
    paddingVertical: 6,
    paddingHorizontal: 12,
    // Sit below the status bar on Android; iOS is handled by the SafeAreaView in
    // the root navigator so this only adds its own vertical padding.
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 6 : 6,
  },
  text: {
    color: Colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
});
