import React from 'react';
import { View, StyleSheet } from 'react-native';
import { radius, voiceShades } from '../../theme/tokens';

/** The C2 sheet handle: drawn only (the sheet closes with its close or cancel action, Back, or the iOS swipe). */
export default function SheetGrip() {
  return (
    <View style={styles.wrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View testID="sheet-grip" style={styles.grip} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 12 },
  grip: { width: 40, height: 5, borderRadius: radius.chip, backgroundColor: voiceShades.track },
});
