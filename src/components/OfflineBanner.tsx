// Slim "you're offline" banner shown at the top of the root navigator.
// Only renders when NetInfo reports the device is disconnected OR the internet
// is explicitly unreachable. A null reachability value is treated as online to
// avoid false positives during the first few hundred ms of app launch.

import React, { useContext } from 'react';
import { View, Text, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useNetworkStatus, isEffectivelyOnline } from '../hooks/useNetworkStatus';
import { colors, layout, lightTokens, typography } from '../theme/tokens';
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
  // OFFLINE-BAND-IPHONE-M (203-D58 op 1): the phone's top inset from the one SafeAreaProvider (App.tsx), 0 with none
  // (tests, previews); read before the return below so every render runs the same hooks.
  const insetTop = useContext(SafeAreaInsetsContext)?.top ?? 0;
  if (isEffectivelyOnline(status)) return null;
  // Read when the banner shows, which is when the network changes.
  const coach = isCoachLikeRole(readUserCacheSync()?.role);
  // iPhone: the band is laid out from the top of the screen, under the app's opaque top strip (StatusBarBand, as tall
  // as the top inset), so its 9 pt start where the strip ends (C2_offline_ios390_100: the ink from 47 pt).
  const style = Platform.OS === 'android' ? styles.banner : [styles.banner, { paddingTop: insetTop + 9 }];

  return (
    <View style={style} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={12} color={lightTokens.textOnAccent} />
      <Text style={styles.text} maxFontSizeMultiplier={1.3}>{coach ? COACH_LINE : CLIENT_LINE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // C2_offline (FIX-974R1, LS-974R1 B3; measured on C2_offline_ios390_100 and _android360_100): a dark ink band under
  // the status bar, a 12 pt icon 6 pt from the words, the app's Inter Medium 13 on an 18 line, 9 pt above and below,
  // left aligned at the 24 pt gutter. C1-S-10 takes two lines at 390 pt and three at 360 pt, as the frames draw it.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.ink,
    paddingVertical: 9,
    paddingHorizontal: layout.gutter,
    // Sit below the status bar on Android, by the height React Native reports (never the safe-area inset as well:
    // under edge to edge it is the same height). On iPhone the top inset is added at render (above).
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 9 : 9,
  },
  text: {
    flex: 1,
    // The warm near-white: 16.32:1 on the ink band (the Sunlit sand page colour would be 15.09:1).
    color: lightTokens.textOnAccent,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 13,
    lineHeight: 18,
  },
});
