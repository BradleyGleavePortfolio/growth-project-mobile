import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from '../../ui/skeletons/Skeleton';
import { spacing } from '../../theme/tokens';
import { ROMAN_LOADING_A11Y_LABEL } from './romanVoice';

/** The same quiet loading state before the consent read and the room read. */
export default function RomanLoadingSkeleton(): React.ReactElement {
  return (
    <View
      style={styles.wrap}
      testID="roman-loading-skeleton"
      accessibilityRole="progressbar"
      accessibilityLabel={ROMAN_LOADING_A11Y_LABEL}
      accessibilityState={{ busy: true }}
    >
      <Skeleton width="70%" height={18} testID="roman-skeleton-line-1" />
      <Skeleton width="55%" height={18} />
      <Skeleton width="80%" height={18} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.xl, gap: spacing.md },
});
