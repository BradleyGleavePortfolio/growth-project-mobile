import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { PtmRiskBucket } from '../types/ptm';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  bucket: PtmRiskBucket;
  size?: number;
  testID?: string;
}

export default function RiskDot({ bucket, size = 12, testID }: Props) {
  const { colors } = useTheme();
  const fill =
    bucket === 'green'
      ? colors.success
      : bucket === 'amber'
        ? colors.warning
        : colors.error;
  return (
    <View
      testID={testID ?? `risk-dot-${bucket}`}
      accessibilityLabel={`${bucket} risk`}
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: fill },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    alignSelf: 'center',
  },
});
