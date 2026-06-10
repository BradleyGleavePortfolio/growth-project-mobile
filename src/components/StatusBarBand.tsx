import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// SDK 56 enables Android edge-to-edge by default, so the app draws behind the
// system status bar. expo-status-bar no longer paints a background colour, and
// the old RNStatusBar.setBackgroundColor() imperative call is a no-op. To keep
// the bone (#F5EFE4) band behind the status-bar icons we paint a View sized to
// the safe-area top inset. It is absolutely positioned so it overlays the
// status-bar area without consuming layout space — matching the prior
// zero-offset behaviour and avoiding a double top inset on screens that apply
// their own safe-area padding. Must live inside a SafeAreaProvider so the inset
// resolves to the real device value (notch / cutout height).
export const STATUS_BAR_BONE = '#F5EFE4';
export const STATUS_BAR_BAND_Z_INDEX = 1000; // above app content, below modal layer

export function StatusBarBand() {
  const insets = useSafeAreaInsets();
  if (insets.top <= 0) return null;
  return (
    <View
      testID="status-bar-band"
      pointerEvents="none"
      style={[styles.band, { height: insets.top, backgroundColor: STATUS_BAR_BONE }]}
    />
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: STATUS_BAR_BAND_Z_INDEX,
    elevation: STATUS_BAR_BAND_Z_INDEX, // Android stacking
  },
});
