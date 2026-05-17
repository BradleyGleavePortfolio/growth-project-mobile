import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { makeStyles } from './styles';

export function ProfileRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={styles.profileValue}>{value}</Text>
    </View>
  );
}
