/**
 * ProfileScreen — Wave 3: luxury redesign.
 *
 * - Identity badge kept (founding-member context lives here, not home).
 * - MilestoneCabinet now renders as MilestoneList (date · note rows).
 * - Closing CTA replaced by date list per brief.
 * - Radius literals cleaned to tokens.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
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
import { layout, radius, typography, type SemanticTokens } from '../../theme/tokens';
import { Headline, Lede, Overline, Screen, ScreenTopBar, TextLink } from '../../ui';
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
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
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

  const initial = currentUser?.name?.trim().charAt(0).toUpperCase() || '';

  return (
    <Screen edges={['top']} testID="profile-screen"
      header={<ScreenTopBar onBack={navigation.goBack ? () => navigation.goBack() : undefined} />}>
      {/* Names are headline-sized (CATALOG): the person is the h1, the page name the overline. */}
      <View style={styles.identity}>
        {initial ? (
          <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        ) : null}
        <Overline>Profile</Overline>
        <Headline level="h1">{currentUser?.name || 'No name set'}</Headline>
        {currentUser?.email ? <Text style={styles.email}>{currentUser.email}</Text> : null}
        {/* Current client-coach sharing state */}
        {privacyCopy ? <Lede size="small" style={styles.privacyLine}>{privacyCopy}</Lede> : null}
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
          <Ionicons name="settings-outline" size={24} color={sc.textMuted} />
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
          <Ionicons name="document-text-outline" size={24} color={sc.textMuted} />
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
          <Ionicons name="apps-outline" size={24} color={sc.textMuted} />
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
          <Ionicons name="book-outline" size={24} color={sc.textMuted} />
          <Text style={styles.actionText}>Learn</Text>
        </HapticPressable>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Personal info</Text>
          <HapticPressable
            intent="light"
            style={styles.editLink}
            onPress={() => {
              track('profile_edit_opened', { source: 'profile_section_header' });
              navigation.navigate('EditProfile');
            }}
            accessibilityRole="button"
            accessibilityLabel="Edit personal info"
          >
            <Text style={styles.editLinkText}>Edit</Text>
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
            <Text style={[styles.rowValue, styles.targetValue]}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Wave 3: MilestoneCabinet renders as MilestoneList */}
      <View style={styles.milestoneCabinetSection}>
        <MilestoneCabinet isFoundingMember={foundingData?.isFoundingMember ?? false} />
      </View>

      <TextLink label="Sign out" tone="ink" underline={false} style={styles.signOut}
        onPress={() => { void handleSignOut(); }} />
    </Screen>
  );
}

// Semantic colours only (U2: the old static grey text was about 2.3:1 on bone; textMuted clears AA).
const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  identity: {
    paddingTop: 8,
    marginBottom: 28,
    gap: 6,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarText: {
    ...typography.h2,
    color: sc.textPrimary,
  },
  email: {
    ...typography.bodySmall,
    color: sc.textMuted,
    fontVariant: ['tabular-nums'],
  },
  privacyLine: {
    marginTop: 6,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginBottom: 36,
  },
  actionBtn: {
    width: '48%',
    minHeight: 88,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
  },
  actionText: {
    ...typography.bodyMd,
    lineHeight: 22,
    color: sc.textPrimary,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: sc.textMuted,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editLink: {
    minHeight: layout.touchMin,
    minWidth: layout.touchMin,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  editLinkText: {
    ...typography.bodySmall,
    fontFamily: 'Inter_500Medium',
    color: sc.accentText,
  },
  sectionStatus: {
    ...typography.bodySmall,
    color: sc.textMuted,
    marginBottom: 12,
  },
  rowValueMissing: {
    color: sc.textMuted,
    fontWeight: '400' as const,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: layout.rowMinHeight,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  rowLabel: {
    ...typography.body,
    lineHeight: 22,
    color: sc.textMuted,
    flex: 1,
    paddingRight: 12,
  },
  rowValue: {
    ...typography.body,
    lineHeight: 22,
    color: sc.textPrimary,
    fontWeight: '500' as const,
    flexShrink: 1,
    maxWidth: '55%',
    textAlign: 'right',
  },
  targetValue: {
    fontVariant: ['tabular-nums'],
  },
  milestoneCabinetSection: {
    marginBottom: 24,
  },
  signOut: {
    marginTop: 8,
  },
});
