/**
 * ProfileScreen — Wave 3: luxury redesign.
 *
 * - Identity badge kept (founding-member context lives here, not home).
 * - MilestoneCabinet now renders as MilestoneList (date · note rows).
 * - Closing CTA replaced by date list per brief.
 * - Radius literals cleaned to tokens.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { prepareSignOutConfirm, signOut } from '../../services/authActions';
import api, { profileApi } from '../../services/api';
import { macrosApi, type MacroTarget } from '../../api/macrosApi';
import { logger } from '../../utils/logger';

import { MoreStackParamList } from '../../navigation/ClientNavigator';
import { useFoundingNumber } from '../../hooks/useIdentity';
import { resolveIdentityTitle } from '../../lib/identityTitle';
import MilestoneCabinet from '../../components/community/MilestoneCabinet';
import { track } from '../../lib/analytics';
import { useEffect } from 'react';
import { colors as colorTokens, typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { getProfileCompletion } from '../../lib/profileCompletion';
import { buildProfileRows, buildTargetRows, type ProfileValues } from './profileDisplay';
type Nav = NativeStackNavigationProp<MoreStackParamList>;
interface SavedValues {
  userId: string;
  profile?: ProfileValues;
  targets?: MacroTarget | null;
  targetStatus?: 'loading' | 'loaded' | 'error';
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const currentUser = useCurrentUser();
  const navigation = useNavigation<Nav>();
  // Saved values from the server, read on every focus (also after Edit).
  // Until they arrive, or if the read fails, the cached profile stands in.
  const [saved, setSaved] = useState<SavedValues>();
  useFocusEffect(useCallback(() => {
    const userId = currentUser?.id;
    if (!userId) return;
    let alive = true;
    const keep = (patch: Partial<Omit<SavedValues, 'userId'>>) => {
      if (alive) setSaved((prev) => ({ ...(prev?.userId === userId ? prev : {}), userId, ...patch }));
    };
    keep({ targetStatus: 'loading' });
    profileApi.get()
      .then((res: { data?: ProfileValues | null }) => { if (res.data && typeof res.data === 'object') keep({ profile: res.data }); })
      .catch(() => logger.warn('ProfileScreen', 'Saved profile did not load'));
    macrosApi.currentForSelf()
      .then((res) => keep({ targets: res.data ?? null, targetStatus: 'loaded' }))
      .catch(() => {
        keep({ targetStatus: 'error' });
        logger.warn('ProfileScreen', 'Daily targets did not load');
      });
    return () => { alive = false; };
  }, [currentUser?.id]));
  const [sharing, setSharing] = useState<{ coachId: string; name: string; workouts: boolean; meals: boolean; ownerAccess: boolean } | null>(null);
  useFocusEffect(useCallback(() => {
    setSharing(null);
    const coachId = currentUser?.coach_id;
    if (!coachId) return;
    let alive = true;
    Promise.all([
      api.get<{ id: string; name: string }>('/v1/clients/me/coach'),
      api.get<{ coach_id: string; owner_access?: unknown; consents: Array<{ scope: string; granted: boolean }> }>(`/consent/me?coach_id=${encodeURIComponent(coachId)}`),
    ]).then(([coach, consent]) => {
      if (!alive || coach.data.id !== coachId || consent.data.coach_id !== coachId) return;
      const ownerAccess = typeof consent.data.owner_access === 'boolean' ? consent.data.owner_access : null;
      const workouts = ownerAccess === true || consent.data.consents.some((c) => c.scope === 'fitness.workouts' && c.granted === true);
      const meals = ownerAccess === true || consent.data.consents.some((c) => c.scope === 'fitness.food_macros' && c.granted === true);
      setSharing(ownerAccess === null && (!workouts || !meals) ? null : {
        coachId, name: coach.data.name || 'your coach', workouts, meals, ownerAccess: ownerAccess === true,
      });
    }).catch(() => { if (alive) setSharing(null); logger.warn('ProfileScreen', 'Sharing status did not load'); });
    return () => { alive = false; };
  }, [currentUser?.id, currentUser?.coach_id]));
  const privacyCopy = !currentUser?.coach_id || sharing?.coachId !== currentUser.coach_id ? null
    : sharing.ownerAccess ? `Workouts and meals are visible to you and ${sharing.name}.`
    : sharing.workouts === sharing.meals
      ? `Workouts and meals are ${sharing.workouts ? 'shared' : 'not shared'} with ${sharing.name}.`
      : `Workouts are ${sharing.workouts ? 'shared' : 'not shared'} with ${sharing.name}. Meals are ${sharing.meals ? 'shared' : 'not shared'} with ${sharing.name}.`;

  const foundingQ = useFoundingNumber();
  const foundingData = foundingQ.data ?? null;

  useEffect(() => {
    track('profile_viewed');
  }, []);

  const identityTitle = resolveIdentityTitle({
    isFoundingMember: foundingData?.isFoundingMember ?? false,
    consecutiveDays: 0,
    totalWorkouts: 0,
    weeksSinceJoin: 0,
  });

  const handleSignOut = async () => {
    // SESSION-KEEP-130: one try to send what is waiting on this phone first;
    // the confirm names anything still unsent (sign-out removes it).
    const message = await prepareSignOutConfirm(currentUser?.id);
    if (message === null) return; // a confirm is already on its way
    Alert.alert('Sign out', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const mine = saved && saved.userId === currentUser?.id ? saved : undefined;
  const shownProfile: ProfileValues | undefined = mine?.profile ?? currentUser?.profile;
  const completion = getProfileCompletion({ profile: shownProfile });
  const profileItems = buildProfileRows(currentUser, shownProfile);
  const targetItems = buildTargetRows(mine ? mine.targets : undefined, shownProfile);
  const targetStatusCopy = targetItems.length > 0 ? null
    : mine?.targetStatus === 'loaded' ? 'No daily targets yet.'
    : mine?.targetStatus === 'error' ? 'Daily targets did not load. Reopen Profile to try again.'
    : 'Loading daily targets.';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {currentUser?.name?.charAt(0)?.toUpperCase() || ''}
          </Text>
        </View>
        <Text style={styles.name}>
          {currentUser?.name || 'No name set'}
        </Text>
        <Text style={styles.email}>{currentUser?.email || ''}</Text>

        {/* Current client-coach sharing state */}
        {privacyCopy ? <Text style={styles.privacyLine}>{privacyCopy}</Text> : null}
      </View>

      {/* Quick Actions — 2×2 grid */}
      <View style={styles.actionsGrid}>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          accessibilityHint="Opens app settings"
        >
          <Ionicons name="settings-outline" size={24} color={colors.primary} />
          <Text style={styles.actionText}>Settings</Text>
        </HapticPressable>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Report')}
          accessibilityRole="button"
          accessibilityLabel="My report"
          accessibilityHint="Opens your progress report"
        >
          <Ionicons name="document-text-outline" size={24} color={colors.primary} />
          <Text style={styles.actionText}>My report</Text>
        </HapticPressable>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Widgets')}
          accessibilityRole="button"
          accessibilityLabel="Shortcuts"
          accessibilityHint="Opens quick actions"
        >
          <Ionicons name="apps-outline" size={24} color={colors.primary} />
          <Text style={styles.actionText}>Shortcuts</Text>
        </HapticPressable>
        <HapticPressable
          intent="light"
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Learn')}
          accessibilityRole="button"
          accessibilityLabel="Learn"
          accessibilityHint="Opens learning content"
        >
          <Ionicons name="book-outline" size={24} color={colors.primary} />
          <Text style={styles.actionText}>Learn</Text>
        </HapticPressable>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Personal info</Text>
          <HapticPressable
            intent="light"
            onPress={() => {
              track('profile_edit_opened', { source: 'profile_section_header' });
              navigation.navigate('EditProfile');
            }}
            accessibilityRole="button"
            accessibilityLabel="Edit personal info"
          >
            <Text style={styles.editLink}>Edit</Text>
          </HapticPressable>
        </View>
        {!completion.isComplete ? (
          <Text style={styles.sectionStatus}>
            {completion.percentComplete}% complete · {completion.missing.length} field
            {completion.missing.length === 1 ? '' : 's'} to add
          </Text>
        ) : null}
        {profileItems.map((item) => (
          <HapticPressable
            key={item.label}
            intent="light"
            style={styles.row}
            onPress={() => {
              track('profile_edit_opened', { source: 'profile_row', field: item.label });
              navigation.navigate('EditProfile');
            }}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${item.value}. Tap to edit.`}
          >
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={[styles.rowValue, item.missing ? styles.rowValueMissing : null]}>
              {item.value}
            </Text>
          </HapticPressable>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Daily targets</Text>
        {targetStatusCopy ? (
          <Text style={styles.sectionStatus}>{targetStatusCopy}</Text>
        ) : null}
        {targetItems.map((item) => (
          <View key={item.label} style={styles.row}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={[styles.rowValue, { color: colors.primary }]}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Wave 3: MilestoneCabinet renders as MilestoneList */}
      <View style={styles.milestoneCabinetSection}>
        <MilestoneCabinet isFoundingMember={foundingData?.isFoundingMember ?? false} />
      </View>

      <HapticPressable intent="warning" style={styles.signOutButton} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.signOutText}>Sign out</Text>
      </HapticPressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorTokens.bone,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 20,
  },
  title: {
    ...typography.h1,
    color: colorTokens.ink,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 4,
    backgroundColor: colorTokens.forest,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 0.5,
    fontWeight: '400',
    color: colorTokens.bone,
  },
  name: {
    ...typography.h3,
    color: colorTokens.ink,
  },
  email: {
    ...typography.body,
    color: colorTokens.stone,
    marginTop: 4,
  },
  // Wave 3: streak as plain text line — "Day 7 of 30." No flame.
  streakLine: {
    ...typography.body,
    color: colorTokens.charcoal,
    marginTop: 10,
  },
  privacyLine: {
    ...typography.bodySmall,
    color: colorTokens.stone,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 24,
    fontStyle: 'italic',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 28,
  },
  actionBtn: {
    width: '47%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colorTokens.cream,
    borderRadius: radius.lg,  // 4
    paddingVertical: 18,
    borderWidth: 0.5,
    borderColor: colorTokens.stone,
  },
  actionText: {
    ...typography.bodySmall,
    color: colorTokens.ink,
    fontWeight: '600' as const,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colorTokens.charcoal,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  editLink: {
    ...typography.bodySmall,
    color: colorTokens.forest,
    fontWeight: '600' as const,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  sectionStatus: {
    ...typography.bodySmall,
    color: colorTokens.stone,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  rowValueMissing: {
    color: colorTokens.stone,
    fontStyle: 'italic',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colorTokens.stone,
  },
  rowLabel: {
    ...typography.body,
    color: colorTokens.stone,
    flex: 1,
    paddingRight: 12,
  },
  rowValue: {
    ...typography.body,
    color: colorTokens.ink,
    fontWeight: '500' as const,
    flexShrink: 1,
    maxWidth: '55%',
    textAlign: 'right',
  },
  milestoneCabinetSection: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginTop: 12,
    paddingVertical: 16,
    backgroundColor: colorTokens.cream,
    borderRadius: radius.lg,  // 4
    borderWidth: 0.5,
    borderColor: colorTokens.stone,
  },
  signOutText: {
    ...typography.body,
    color: colorTokens.error,
    fontWeight: '600' as const,
  },
});
