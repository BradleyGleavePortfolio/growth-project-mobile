import React from 'react';
import { View, StyleSheet } from 'react-native';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

/** The C2 sheet handle: drawn only (the sheet closes with its close or cancel action, Back, a tap on the dim or a pull
 *  down on its top). REFINE-968 (C_add.html :60 .grab): 36 x 5 in the border colour, 10 above and 14 below. */
export default function SheetGrip() {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.wrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View testID="sheet-grip" style={[styles.grip, { backgroundColor: sc.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 14 },
  grip: { width: 36, height: 5, borderRadius: radius.chip },
});
