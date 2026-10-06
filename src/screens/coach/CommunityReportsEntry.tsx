import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useCoachFlagged } from '../../hooks/useCoachCommunity';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * "Reports" button in the coach Messages header (AUDIT-10-125 B-1, Apple 1.2).
 *
 * Members report posts, comments and wins from every community surface, and
 * Community safety promises a review within 24 hours. The coach Community tab
 * is off in the store build, so without this entry no coach screen opened the
 * report queue. It opens the existing moderation queue (Hide / Warn / Ban /
 * Dismiss) registered in the Clients stack and shows the open count.
 *
 * Shown only when GET /community/moderation/flagged answers: hidden while the
 * community API is off (503), on a backend without the route (404), and while
 * the probe is loading or failed, the same pattern as BroadcastsEntry.
 */
export function CommunityReportsEntry() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const flagged = useCoachFlagged();
  if (!Array.isArray(flagged.data)) return null;
  const open = flagged.data.length;
  const label =
    open === 0
      ? 'Open community reports, none waiting'
      : `Open community reports, ${open} waiting for review`;
  return (
    <Pressable
      // `initial: false` keeps the client list under the queue, so a Clients
      // stack opened here for the first time still has its root.
      onPress={() =>
        navigation.navigate('ClientsStack', { screen: 'CoachCommunityModeration', initial: false })
      }
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.button, { borderColor: open > 0 ? colors.error : colors.border }]}
      testID="messages-community-reports-entry"
    >
      <Ionicons name="flag-outline" size={16} color={open > 0 ? colors.error : colors.textPrimary} />
      <Text style={[typography.bodySmall, { color: colors.textPrimary }]}>Reports</Text>
      {open > 0 ? (
        <View style={[styles.count, { backgroundColor: colors.error }]}>
          <Text
            style={[typography.bodySmall, styles.countText, { color: colors.textOnPrimary }]}
            testID="messages-community-reports-count"
          >
            {open > 99 ? '99+' : String(open)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: spacing.md,
  },
  count: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countText: { fontWeight: '600' },
});
