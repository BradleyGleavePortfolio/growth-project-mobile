import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../../config/featureFlags';
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { HapticService } from '../../ui/haptics/haptics.service';

/**
 * COACHTABS — "Community" button in the coach Messages header. With the six
 * tabs (featureFlags.coachTabsV2) Community is not a tab: while
 * featureFlags.coachCommunity is on it opens from here, and the bar keeps
 * Messages selected until the coach goes back.
 */
export function CommunityEntry() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  if (!featureFlags.coachTabsV2 || !featureFlags.coachCommunity) return null;
  return (
    <Pressable
      onPress={() => {
        HapticService.softImpact();
        navigation.navigate('CommunityStack');
      }}
      accessibilityRole="button"
      accessibilityLabel="Community"
      style={[styles.button, { borderColor: colors.border }]}
      testID="messages-community-entry"
    >
      <Ionicons name="people-circle-outline" size={16} color={colors.textPrimary} />
      <Text style={[typography.bodySmall, { color: colors.textPrimary }]}>Community</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderRadius: radius.button, paddingHorizontal: spacing.md },
});
