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
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { featureFlags } from '../../config/featureFlags';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  useCommunityBadge,
  useCommunityMe,
} from '../../hooks/useCommunity';
import SpaceTabBar, {
  type CommunitySpaceKey,
  type SpaceTab,
} from '../../components/community/SpaceTabBar';
import CommunityTodayScreen from './CommunityTodayScreen';
import CommunitySpaceScreen from './CommunitySpaceScreen';
import CommunityDmListScreen from './CommunityDmListScreen';
import CommunityChallengesScreen from './CommunityChallengesScreen';
import type { CommunityNav } from './communityNavTypes';

export default function CommunityTabScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const client = useCurrentUser();
  const badge = useCommunityBadge(client?.id);
  const me = useCommunityMe();

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
      <SpaceTabBar
        tabs={tabs}
        active={active}
        onSelect={setActive}
        testID="community-space-tabbar"
      />
      <View style={styles.body}>
        {active === 'today' ? (
          <CommunityTodayScreen embedded />
        ) : active === 'hall' ? (
          <CommunitySpaceScreen embedded space="hall" workspaceId={workspaceId} />
        ) : active === 'cohorts' ? (
          <CommunitySpaceScreen
            embedded
            space="cohort"
            workspaceId={workspaceId}
          />
        ) : active === 'challenges' ? (
          // Embedded discovery list. We pass the resolved workspaceId from the
          // same `useCommunityMe` source the other Spaces use; a still-loading
          // or errored prerequisite resolves to null, which the screen treats
          // as not-yet-resolved rather than an empty workspace.
          <CommunityChallengesScreen embedded workspaceId={workspaceId} />
        ) : (
          <CommunityDmListScreen embedded workspaceId={workspaceId} />
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
});
