/**
 * ProfileNudge — Home's "Finish your profile" section: the sentence that names what the missing
 * answers change (B29) and how complete the profile is; a tap opens Edit profile. Moved out of
 * HomeScreen unchanged, so today's Home and the rings Home's notice slot show one copy.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../lib/analytics';
import { getProfileCompletion, profileNudgeLine, summarizeMissing } from '../../lib/profileCompletion';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';
import { useNoticeSlot } from './HomeNoticeSlot';

export default function ProfileNudge({ hasCoachPlan, hasTargets }: { hasCoachPlan: boolean; hasTargets: boolean }) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const completion = getProfileCompletion(currentUser);
  const shown = useNoticeSlot('profile', !completion.isComplete && completion.missing.length > 0);

  // Fire impression once per user/session combination so we can attribute
  // cold-outbound conversion to nudge exposure later.
  useEffect(() => {
    if (shown && currentUser?.id) {
      track('profile_nudge_shown', {
        missing_count: completion.missing.length,
        percent_complete: completion.percentComplete,
      });
    }
  }, [currentUser?.id, shown, completion.missing.length, completion.percentComplete]);

  if (!shown) return null;
  return (
    <Pressable
      onPress={() => {
        track('profile_edit_opened', { source: 'home_nudge' });
        navigation.navigate('MoreTab', { screen: 'EditProfile' });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Complete your profile. Missing ${summarizeMissing(completion.missing)}.`}
      style={({ pressed }) => ({
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: sc.border,
        paddingVertical: 18,
        minHeight: 44,
        marginBottom: 24,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ ...typography.eyebrow, color: sc.textMuted, marginBottom: 6 }}>
        FINISH YOUR PROFILE
      </Text>
      {/* B29: the sentence names what the missing answers change; targets only when a target input is missing and none are shown. */}
      <Text style={{ ...typography.body, color: sc.textPrimary }}>
        {profileNudgeLine(completion.missing, { hasCoachPlan, hasTargets })}
      </Text>
      <Text style={{ ...typography.bodySmall, color: sc.textMuted, marginTop: 6, fontVariant: ['tabular-nums'] }}>
        {`${completion.percentComplete}% complete`}
      </Text>
    </Pressable>
  );
}
