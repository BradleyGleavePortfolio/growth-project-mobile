/**
 * CommunityNavigator — the Community sub-stack (v1-5 client surface). Registers
 * the seven Community screens against the typed CommunityStackParamList.
 *
 * IMPORTANT (flag posture): this navigator is only ever MOUNTED by
 * ClientNavigator when `featureFlags.communityTab` is true. When the flag is
 * OFF the Community tab is not rendered and this stack never enters the tree,
 * so none of these routes are reachable. See ClientNavigator.tsx.
 *
 * v2-3 EVENTS containment: the CommunityEventDetail route is registered ONLY
 * when `featureFlags.communityEvents` is true. With that flag OFF the route
 * never registers, so there is zero event UI, no event navigator target, and
 * no reachable event surface — even though the Community tab itself may be on.
 *
 * v3-2 CLASSROOM containment: the CommunityClassroom (feed) and
 * CommunityLessonDetail routes are registered ONLY when
 * `featureFlags.communityClassroom` is true. With that flag OFF (the default)
 * neither route registers, so the read-only student classroom surface is dead
 * code at build time and unreachable.
 *
 * v3-3 VOICE NOTES containment: the CommunityVoiceComposer route is registered
 * ONLY when `featureFlags.communityVoiceNotes` is true. With that flag OFF (the
 * default) the route never registers, so the record/send voice surface is dead
 * code at build time and unreachable.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/tokens';
import { featureFlags } from '../config/featureFlags';
import CommunityTabScreen from '../screens/community/CommunityTabScreen';
import CommunityTodayScreen from '../screens/community/CommunityTodayScreen';
import CommunitySpaceScreen from '../screens/community/CommunitySpaceScreen';
import CommunityThreadScreen from '../screens/community/CommunityThreadScreen';
import CommunityEventDetailScreen from '../screens/community/CommunityEventDetailScreen';
import CommunityDmListScreen from '../screens/community/CommunityDmListScreen';
import CommunityDmThreadScreen from '../screens/community/CommunityDmThreadScreen';
import CommunityComposerScreen from '../screens/community/CommunityComposerScreen';
import CommunityChallengeDetailScreen from '../screens/community/CommunityChallengeDetailScreen';
import CommunityChallengesScreen from '../screens/community/CommunityChallengesScreen';
import CommunityClassroomScreen from '../screens/community/CommunityClassroomScreen';
import CommunityLessonDetailScreen from '../screens/community/CommunityLessonDetailScreen';
import CommunityVoiceComposerScreen from '../screens/community/CommunityVoiceComposerScreen';
import type { CommunityStackParamList } from '../screens/community/communityNavTypes';

const CommunityStack = createNativeStackNavigator<CommunityStackParamList>();

export default function CommunityNavigator(): React.ReactElement {
  return (
    <CommunityStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bone },
      }}
    >
      <CommunityStack.Screen name="CommunityTab" component={CommunityTabScreen} />
      <CommunityStack.Screen name="CommunityToday" component={CommunityTodayScreen} />
      <CommunityStack.Screen name="CommunitySpace" component={CommunitySpaceScreen} />
      <CommunityStack.Screen name="CommunityThread" component={CommunityThreadScreen} />
      {featureFlags.communityEvents && (
        <CommunityStack.Screen name="CommunityEventDetail" component={CommunityEventDetailScreen} />
      )}
      <CommunityStack.Screen name="CommunityDmList" component={CommunityDmListScreen} />
      <CommunityStack.Screen name="CommunityDmThread" component={CommunityDmThreadScreen} />
      <CommunityStack.Screen name="CommunityComposer" component={CommunityComposerScreen} />
      {featureFlags.communityChallenges ? (
        <CommunityStack.Screen
          name="CommunityChallenges"
          component={CommunityChallengesScreen}
        />
      ) : null}
      {featureFlags.communityChallenges ? (
        <CommunityStack.Screen
          name="CommunityChallengeDetail"
          component={CommunityChallengeDetailScreen}
        />
      ) : null}
      {featureFlags.communityClassroom ? (
        <CommunityStack.Screen
          name="CommunityClassroom"
          component={CommunityClassroomScreen}
        />
      ) : null}
      {featureFlags.communityClassroom ? (
        <CommunityStack.Screen
          name="CommunityLessonDetail"
          component={CommunityLessonDetailScreen}
        />
      ) : null}
      {featureFlags.communityVoiceNotes ? (
        <CommunityStack.Screen
          name="CommunityVoiceComposer"
          component={CommunityVoiceComposerScreen}
        />
      ) : null}
    </CommunityStack.Navigator>
  );
}
