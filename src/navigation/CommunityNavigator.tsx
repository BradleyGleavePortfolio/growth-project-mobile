/**
 * CommunityNavigator — the Community sub-stack (v1-5 client surface). Registers
 * the seven Community screens against the typed CommunityStackParamList.
 *
 * IMPORTANT (flag posture): this navigator is only ever MOUNTED by
 * ClientNavigator when `featureFlags.communityTab` is true. When the flag is
 * OFF the Community tab is not rendered and this stack never enters the tree,
 * so none of these routes are reachable. See ClientNavigator.tsx.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/tokens';
import CommunityTabScreen from '../screens/community/CommunityTabScreen';
import CommunityTodayScreen from '../screens/community/CommunityTodayScreen';
import CommunitySpaceScreen from '../screens/community/CommunitySpaceScreen';
import CommunityThreadScreen from '../screens/community/CommunityThreadScreen';
import CommunityEventDetailScreen from '../screens/community/CommunityEventDetailScreen';
import CommunityDmListScreen from '../screens/community/CommunityDmListScreen';
import CommunityDmThreadScreen from '../screens/community/CommunityDmThreadScreen';
import CommunityComposerScreen from '../screens/community/CommunityComposerScreen';
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
      <CommunityStack.Screen name="CommunityEventDetail" component={CommunityEventDetailScreen} />
      <CommunityStack.Screen name="CommunityDmList" component={CommunityDmListScreen} />
      <CommunityStack.Screen name="CommunityDmThread" component={CommunityDmThreadScreen} />
      <CommunityStack.Screen name="CommunityComposer" component={CommunityComposerScreen} />
    </CommunityStack.Navigator>
  );
}
