/**
 * ProfileNudge — Home's "Finish your profile" section: the sentence that names what the missing
 * answers change (B29) and how complete the profile is; a tap opens Edit profile. Moved out of
 * HomeScreen, so today's Home and the rings Home's notice slot show one copy. In the slot only
 * (#RINGS-NOTICE-ORDER), "Not now" hides it for this account for PROFILE_NUDGE_HIDE_MS.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../lib/analytics';
import { getProfileCompletion, profileNudgeLine, summarizeMissing } from '../../lib/profileCompletion';
import { prefsStorage } from '../../storage/mmkv';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';
import { QuietSection, quietActions } from '../../ui/sections/QuietSection';
import { useInNoticeSlot, useNoticeSlot } from './HomeNoticeSlot';

/** 7 days: the operator's default, waiting on the owner (#RINGS-NOTICE-ORDER). */
export const PROFILE_NUDGE_HIDE_MS = 7 * 24 * 60 * 60 * 1000;
export const profileNudgeHiddenKey = (userId: string) => `home.profile_nudge_hidden_until:${userId}`;

export default function ProfileNudge({ hasCoachPlan, hasTargets }: { hasCoachPlan: boolean; hasTargets: boolean }) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const completion = getProfileCompletion(currentUser);
  // In the slot: hidden until this account's stored time (ms); hidden while that is read, so it never flashes.
  const key = useInNoticeSlot() && currentUser?.id ? profileNudgeHiddenKey(currentUser.id) : null;
  const [hidden, setHidden] = useState<{ key: string; until: number } | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const done = (v?: string) => live && setHidden({ key, until: Number(v) || 0 });
    prefsStorage.getStringAsync(key).then(done, () => done());
    return () => { live = false; };
  }, [key]);
  const until = hidden && hidden.key === key ? hidden.until : null;
  const hiddenNow = !!key && (until === null || Date.now() < until);
  const shown = useNoticeSlot('profile', !hiddenNow && !completion.isComplete && completion.missing.length > 0);

  // Fire impression once per user/session combination so we can attribute cold-outbound conversion to nudge exposure later.
  useEffect(() => {
    if (shown && currentUser?.id) track('profile_nudge_shown', { missing_count: completion.missing.length, percent_complete: completion.percentComplete });
  }, [currentUser?.id, shown, completion.missing.length, completion.percentComplete]);

  if (!shown) return null;
  const open = (
    <Pressable
      onPress={() => { track('profile_edit_opened', { source: 'home_nudge' }); navigation.navigate('MoreTab', { screen: 'EditProfile' }); }}
      accessibilityRole="button"
      accessibilityLabel={`Complete your profile. Missing ${summarizeMissing(completion.missing)}.`}
      style={({ pressed }) => [!key && [styles.section, { borderColor: sc.border }], { minHeight: 44, opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={{ ...typography.eyebrow, color: sc.textMuted, marginBottom: 6 }}>FINISH YOUR PROFILE</Text>
      {/* B29: the sentence names what the missing answers change; targets only when a target input is missing and none are shown. */}
      <Text style={{ ...typography.body, color: sc.textPrimary }}>{profileNudgeLine(completion.missing, { hasCoachPlan, hasTargets })}</Text>
      <Text style={{ ...typography.bodySmall, color: sc.textMuted, marginTop: 6, fontVariant: ['tabular-nums'] }}>{`${completion.percentComplete}% complete`}</Text>
    </Pressable>
  );
  if (!key) return open;
  const dismiss = () => {
    const next = Date.now() + PROFILE_NUDGE_HIDE_MS;
    setHidden({ key, until: next });
    prefsStorage.set(key, String(next)).catch(() => undefined);
  };
  return (
    <QuietSection testID="profile-nudge">
      {open}
      <View style={quietActions.row}>
        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Not now" testID="profile-nudge-dismiss"
          style={({ pressed }) => [quietActions.action, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[quietActions.label, { color: sc.textMuted }]}>Not now</Text>
        </Pressable>
      </View>
    </QuietSection>
  );
}

const styles = StyleSheet.create({ section: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 18, marginBottom: 24 } });
