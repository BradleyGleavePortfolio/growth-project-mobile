/**
 * CoachCommunityNavigator — the v1-6 Coach Community sub-stack. Registers the
 * six CoachCommunity screens (Home, Inbox, Cohorts, CohortDetail, PostDetail,
 * Moderation) against the typed CoachCommunityStackParamList.
 *
 * IMPORTANT (flag posture): this navigator is only ever MOUNTED by
 * CoachNavigator when `featureFlags.coachCommunity` is true. When the flag is
 * OFF the Community tab is not rendered and this stack never enters the tree,
 * so none of these routes are reachable (the flag-OFF deep-link test asserts
 * exactly this). See CoachNavigator.tsx.
 *
 * v2-3 EVENTS containment: the CoachCommunityEvents route is registered ONLY
 * when `featureFlags.communityEvents` is true. With that flag OFF the route
 * never registers, so there is zero event UI and no reachable event surface —
 * even though the coach Community tab itself may be on.
 *
 * v3-4 WEARABLE PROMPTS containment: the CoachCommunityWearablePrompts route
 * (the COACH-ONLY wearable coaching prompts surface) is registered ONLY when
 * `featureFlags.communityWearablePrompts` is true. With that flag OFF the route
 * never registers, so the coach-only surface is unreachable by deep link. The
 * screen self-renders its header, so it is mounted with `headerShown: false`.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '../theme';
import { featureFlags } from '../config/featureFlags';
import CoachCommunityHomeScreen from '../screens/community/CoachCommunityHomeScreen';
import CoachCommunityInboxScreen from '../screens/community/CoachCommunityInboxScreen';
import CoachCommunityCohortsScreen from '../screens/community/CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../screens/community/CoachCommunityCohortDetailScreen';
import CoachCommunityPostDetailScreen from '../screens/community/CoachCommunityPostDetailScreen';
import CoachCommunityModerationScreen from '../screens/community/CoachCommunityModerationScreen';
import CoachCommunityEventsScreen from '../screens/community/CoachCommunityEventsScreen';
import CommunityWearablePromptsScreen from '../screens/community/CommunityWearablePromptsScreen';
import type { CoachCommunityStackParamList } from '../screens/community/coachCommunityNavTypes';

const CoachCommunityStack =
  createNativeStackNavigator<CoachCommunityStackParamList>();

export default function CoachCommunityNavigator(): React.ReactElement {
  return (
    <CoachCommunityStack.Navigator
      screenOptions={{
        headerShown: true,
        headerTintColor: Colors.textPrimary,
        headerStyle: { backgroundColor: Colors.surface },
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <CoachCommunityStack.Screen
        name="CoachCommunityHome"
        component={CoachCommunityHomeScreen}
        options={{ title: 'Community' }}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityInbox"
        component={CoachCommunityInboxScreen}
        options={{ title: 'Inbox' }}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityCohorts"
        component={CoachCommunityCohortsScreen}
        options={{ title: 'Cohorts' }}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityCohortDetail"
        component={CoachCommunityCohortDetailScreen}
        options={{ title: 'Cohort' }}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityPostDetail"
        component={CoachCommunityPostDetailScreen}
        options={{ title: 'Post' }}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityModeration"
        component={CoachCommunityModerationScreen}
        options={{ title: 'Moderation' }}
      />
      {featureFlags.communityEvents && (
        <CoachCommunityStack.Screen
          name="CoachCommunityEvents"
          component={CoachCommunityEventsScreen}
          options={{ title: 'Events' }}
        />
      )}
      {featureFlags.communityWearablePrompts ? (
        <CoachCommunityStack.Screen
          name="CoachCommunityWearablePrompts"
          component={CommunityWearablePromptsScreen}
          options={{ headerShown: false }}
        />
      ) : null}
    </CoachCommunityStack.Navigator>
  );
}
