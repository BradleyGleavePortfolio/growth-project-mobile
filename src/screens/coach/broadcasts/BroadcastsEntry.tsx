import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { broadcastsAvailable } from '../../../api/broadcastsApi';
import { spacing, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';

/**
 * "Broadcasts" button in the coach Messages header. Shown only when the
 * backend answers GET /coach/broadcasts: hidden while FEATURE_COACH_BROADCASTS
 * is off (503 broadcasts.disabled), on a backend without the module (404), and
 * while the probe is loading or failed.
 */
export function BroadcastsEntry() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const q = useQuery({ queryKey: ['broadcasts', 'available'], queryFn: broadcastsAvailable, staleTime: 5 * 60_000 });
  if (q.data !== true) return null;
  return (
    <Pressable
      onPress={() => navigation.navigate('ClientsStack', { screen: 'CoachBroadcasts' })}
      accessibilityRole="button"
      accessibilityLabel="Open broadcasts"
      style={[styles.button, { borderColor: colors.border }]}
      testID="messages-broadcasts-entry"
    >
      <Ionicons name="megaphone-outline" size={16} color={colors.textPrimary} />
      <Text style={[typography.bodySmall, { color: colors.textPrimary }]}>Broadcasts</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderRadius: 2, paddingHorizontal: spacing.md },
});
