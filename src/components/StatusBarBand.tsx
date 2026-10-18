import React, { useCallback, useSyncExternalStore } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { lightTokens } from '../theme/tokens';

// SDK 56 enables Android edge-to-edge by default, so the app draws behind the
// system status bar. expo-status-bar no longer paints a background colour, and
// the old RNStatusBar.setBackgroundColor() imperative call is a no-op. To keep
// the screen's colour behind the status-bar icons we paint a View sized to
// the safe-area top inset. It is absolutely positioned so it overlays the
// status-bar area without consuming layout space — matching the prior
// zero-offset behaviour and avoiding a double top inset on screens that apply
// their own safe-area padding. Must live inside a SafeAreaProvider so the inset
// resolves to the real device value (notch / cutout height). Bone is the default.
export const STATUS_BAR_BONE = '#F5EFE4';
export const STATUS_BAR_BAND_Z_INDEX = 1000; // above app content, below modal layer

// A focused dark screen owns both the inset colour and its icon contrast.
// Blur/unmount restores the app's bone band and underlying dark status icons.
// One store for every such screen: each focus adds its own entry and its blur
// removes only that entry, so the newest focused screen paints the band and
// the order of one screen's blur and the next one's focus does not matter.
let owners: { color: string }[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const setOwners = (next: { color: string }[]) => {
  owners = next;
  listeners.forEach((listener) => listener());
};

export function useStatusBarBand(color: string) {
  useFocusEffect(useCallback(() => {
    const owner = { color };
    setOwners([...owners, owner]);
    return () => setOwners(owners.filter((o) => o !== owner));
  }, [color]));
}

// K1-OVERVIEW: the coach's client file, whose deep-forest masthead runs to the top edge.
export function ForestStatusBar() {
  useStatusBarBand(lightTokens.surface.masthead);
  return null;
}

export function StatusBarBand() {
  const insets = useSafeAreaInsets();
  const color = useSyncExternalStore(subscribe, () => owners[owners.length - 1]?.color);
  if (insets.top <= 0) return null;
  return (
    <View
      testID="status-bar-band"
      pointerEvents="none"
      style={[styles.band, { height: insets.top, backgroundColor: color ?? STATUS_BAR_BONE }]}
    >{color ? <StatusBar style="light" /> : null}</View>
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
