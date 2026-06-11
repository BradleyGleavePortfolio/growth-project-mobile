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
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Colors } from '../theme';
import CoachCommunityHomeScreen from '../screens/community/CoachCommunityHomeScreen';
import CoachCommunityInboxScreen from '../screens/community/CoachCommunityInboxScreen';
import CoachCommunityCohortsScreen from '../screens/community/CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../screens/community/CoachCommunityCohortDetailScreen';
import CoachCommunityPostDetailScreen from '../screens/community/CoachCommunityPostDetailScreen';
import CoachCommunityModerationScreen from '../screens/community/CoachCommunityModerationScreen';
import CoachCommunityEventsScreen from '../screens/community/CoachCommunityEventsScreen';
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
      <CoachCommunityStack.Screen
        name="CoachCommunityEvents"
        component={CoachCommunityEventsScreen}
        options={{ title: 'Events' }}
      />
    </CoachCommunityStack.Navigator>
  );
}
