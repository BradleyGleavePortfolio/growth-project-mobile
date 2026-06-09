import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// SDK 56 enables Android edge-to-edge by default, so the app draws behind the
// system status bar. expo-status-bar no longer paints a background colour, and
// the old RNStatusBar.setBackgroundColor() imperative call is a no-op. To keep
// the bone (#F5EFE4) band behind the status-bar icons we paint a top-inset
// View sized to the safe-area top inset. Must live inside a SafeAreaProvider
// so the inset resolves to the real device value (notch / cutout height).
export const STATUS_BAR_BONE = '#F5EFE4';

export function StatusBarBand() {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="status-bar-band"
      style={{ height: insets.top, backgroundColor: STATUS_BAR_BONE }}
    />
  );
}
