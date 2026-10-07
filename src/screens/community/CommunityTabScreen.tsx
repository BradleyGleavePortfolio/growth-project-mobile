/**
 * CommunityTabScreen — container for the Community tab with the Space sub-tab
 * switcher (product plan §2.1: three fixed Space types, NOT infinite channels).
 *
 * Sub-tabs:
 *   - Today   → CommunityTodayScreen (the "today" object, §2.6)
 *   - Hall    → CommunitySpaceScreen(space=hall)  (gated by communityHall flag)
 *   - Cohorts → CommunitySpaceScreen(space=cohort) (gated by communityCohorts)
 *   - DMs     → CommunityDmListScreen (gated by communityDm flag)
 *
 * The live unread badge on each sub-tab updates via the Realtime subscription
 * (useCommunityBadge), NOT polling. The header carries the calling client's
 * unread total. UI says "client" for the calling user's role (UX gate §6).
 *
 * Standardized on semanticColors / tokens.ts.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../components/HapticPressable';
import { spacing, typography } from '../../theme/tokens';
import type { CommunityNav } from './communityNavTypes';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { featureFlags } from '../../config/featureFlags';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  useCommunityBadge,
  useCommunityMe,
} from '../../hooks/useCommunity';
import {
  type CommunitySpaceKey,
  type SpaceTab,
} from '../../components/community/SpaceTabBar';
import CommunityTodayScreen from './CommunityTodayScreen';
import CommunitySpaceScreen from './CommunitySpaceScreen';
import CommunityDmListScreen from './CommunityDmListScreen';
import CommunityChallengesScreen from './CommunityChallengesScreen';

export default function CommunityTabScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const client = useCurrentUser();
  const badge = useCommunityBadge(client?.id);
  const me = useCommunityMe();
  const hasCoach = Boolean(client?.coach_id);

  const [active, setActive] = useState<CommunitySpaceKey>('today');

  const tabs = useMemo<SpaceTab[]>(() => {
    const list: SpaceTab[] = [{ key: 'today', label: 'Today' }];
    if (featureFlags.communityHall) {
      list.push({ key: 'hall', label: 'Hall', unread: badge.mentions });
    }
    if (featureFlags.communityCohorts) {
      list.push({
        key: 'cohorts',
        label: 'Cohorts',
        unread: badge.cohortMessages,
      });
    }
    // Challenges discovery is a first-class Space sub-tab when the v3-1 flag is
    // on. This is the entry that makes the challenge list reachable from the
    // client UI. No unread badge: challenges are not a messaging surface, so
    // there is no unread count to carry.
    if (featureFlags.communityChallenges) {
      list.push({ key: 'challenges', label: 'Challenges' });
    }
    if (featureFlags.communityDm) {
      list.push({ key: 'dms', label: 'Messages', unread: badge.dmMessages });
    }
    return list;
  }, [badge.mentions, badge.cohortMessages, badge.dmMessages]);

  const workspaceId = me.data?.workspace_id ?? null;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-tab-screen"
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist"
        testID="community-space-tabbar" contentContainerStyle={styles.segments}
        style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: semanticColors.border }}>
        {tabs.map((tab) => (
          <HapticPressable key={tab.key} intent="light" accessibilityRole="tab"
            accessibilityLabel={tab.unread ? `${tab.label}, ${tab.unread} unread` : tab.label}
            accessibilityState={{ selected: active === tab.key }} testID={`space-tab-${tab.key}`}
            onPress={() => setActive(tab.key)}
            style={[styles.segment, { borderBottomWidth: active === tab.key ? 2 : 0, borderBottomColor: semanticColors.accent }]}>
            <Text style={[typography.bodySmall, { color: active === tab.key ? semanticColors.textPrimary : semanticColors.textMuted }]}>{tab.label}</Text>
            {tab.unread ? (
              <Text testID={`space-tab-${tab.key}-badge`}
                style={[typography.bodySmall, { color: semanticColors.textMuted, fontVariant: ['tabular-nums'] }]}>
                {tab.unread}
              </Text>
            ) : null}
          </HapticPressable>
        ))}
      </ScrollView>
      <View style={styles.linkRow}>
        {featureFlags.communitySearch ? (
          <HapticPressable intent="light" accessibilityRole="button" accessibilityLabel="Find"
            testID="community-find-link" onPress={() => navigation.navigate('CommunityFind')} style={styles.headerLink}>
            <Text style={[styles.safetyText, { color: semanticColors.textMuted }]}>Find</Text>
          </HapticPressable>
        ) : null}
        {featureFlags.communityClassroom ? (
          <HapticPressable intent="light" accessibilityRole="button" accessibilityLabel="Classroom"
            testID="community-classroom-link" onPress={() => navigation.navigate('CommunityClassroom')} style={styles.headerLink}>
            <Text style={[styles.safetyText, { color: semanticColors.textMuted }]}>Classroom</Text>
          </HapticPressable>
        ) : null}
        {/* Opt-in board of one coach's clients: no coach, no entry point. */}
        {hasCoach ? (
          <HapticPressable
            intent="light"
            onPress={() => navigation.navigate('Leaderboard')}
            accessibilityRole="button"
            accessibilityLabel="Leaderboard: opt-in ranking with your coach's other clients"
            style={styles.headerLink}
            testID="community-leaderboard-link"
          >
            <Ionicons name="stats-chart-outline" size={14} color={semanticColors.textMuted} />
            <Text style={[styles.safetyText, { color: semanticColors.textMuted }]}>Leaderboard</Text>
          </HapticPressable>
        ) : null}
        {/* Apple 1.2: guidelines, report/block help, contact and block list. */}
        <HapticPressable
          intent="light"
          onPress={() => navigation.navigate('CommunitySafety')}
          accessibilityRole="button"
          accessibilityLabel="Community safety: guidelines, reporting, blocking and contact"
          style={[styles.headerLink, styles.safetyLink]}
          testID="community-safety-link"
        >
          <Ionicons name="shield-checkmark-outline" size={14} color={semanticColors.textMuted} />
          <Text style={[styles.safetyText, { color: semanticColors.textMuted }]}>
            Community safety
          </Text>
        </HapticPressable>
      </View>
      <View style={styles.body}>
        {active === 'today' ? (
          <CommunityTodayScreen embedded />
        ) : active === 'hall' ? (
          // Embedded post feed. As with Challenges, thread the prerequisite
          // truth (loading / error / retry) so a real `/community/me` failure
          // renders the calm retryable error instead of an inert empty feed —
          // the embedded path must not swallow it.
          <CommunitySpaceScreen
            embedded
            space="hall"
            workspaceId={workspaceId}
            prerequisiteLoading={me.isLoading}
            prerequisiteError={me.isError}
            onRetryPrerequisite={() => void me.refetch()}
          />
        ) : active === 'cohorts' ? (
          <CommunitySpaceScreen
            embedded
            space="cohort"
            workspaceId={workspaceId}
            prerequisiteLoading={me.isLoading}
            prerequisiteError={me.isError}
            onRetryPrerequisite={() => void me.refetch()}
          />
        ) : active === 'challenges' ? (
          // Embedded discovery list. We pass the resolved workspaceId from the
          // same `useCommunityMe` source the other Spaces use AND thread the
          // prerequisite truth (loading / error / retry) so a real
          // `/community/me` failure renders the calm retryable error instead of
          // an indefinite loading state — the embedded path must not swallow it.
          <CommunityChallengesScreen
            embedded
            workspaceId={workspaceId}
            prerequisiteLoading={me.isLoading}
            prerequisiteError={me.isError}
            onRetryPrerequisite={() => void me.refetch()}
          />
        ) : (
          // Embedded DM inbox. Thread the prerequisite truth so a real
          // `/community/me` failure renders the calm retryable error instead of
          // an inert empty inbox — the embedded path must not swallow it.
          <CommunityDmListScreen
            embedded
            workspaceId={workspaceId}
            prerequisiteLoading={me.isLoading}
            prerequisiteError={me.isError}
            onRetryPrerequisite={() => void me.refetch()}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  segments: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  segment: { minHeight: 48, minWidth: 44, flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  headerLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  safetyLink: { marginLeft: 'auto' },
  safetyText: {
    ...typography.bodySmall,
    fontSize: 13,
  },
});
