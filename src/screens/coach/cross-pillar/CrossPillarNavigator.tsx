/**
 * CrossPillarNavigator — Stage-3 nested stack mounted in place of the
 * Stage-2 BothPillarsScreen stub.
 *
 * Param list:
 *   - PracticeSelection         — first-run picker (and Settings drilldown)
 *   - CrossPillarHome           — dashboard
 *   - CrossPillarClients        — universal roster + search
 *   - CrossPillarClientDetail   — unified client EHR view
 *   - CrossPillarMessages       — combined inbox
 *   - CrossPillarAssignments    — combined assignments
 *
 * Initial-route logic: this navigator is a single component file, so we
 * decide at render time which screen to mount as the root. If the
 * coach's `practice_type` is `null` or not `'both'`, the
 * PracticeSelection screen mounts first and the rest of the stack only
 * becomes reachable after a successful save.
 *
 * The decision is made off `useCurrentUser()` which already holds the
 * Prisma User row (including `coach_practice_type`). On first load the
 * value may be undefined — we render a lightweight skeleton until it
 * resolves.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useTheme } from '../../../theme/ThemeProvider';
import { practiceTypeApi } from '../../../services/api';
import type { CoachPracticeType } from '../../../types/crossPillar';

import CrossPillarHomeScreen from './CrossPillarHomeScreen';
import CrossPillarClientsListScreen from './CrossPillarClientsListScreen';
import CrossPillarClientDetailScreen from './CrossPillarClientDetailScreen';
import CrossPillarMessagesScreen from './CrossPillarMessagesScreen';
import CrossPillarAssignmentsScreen from './CrossPillarAssignmentsScreen';
import PracticeSelectionScreen from './PracticeSelectionScreen';

export type CrossPillarStackParamList = {
  PracticeSelection: { current?: CoachPracticeType | null } | undefined;
  CrossPillarHome: undefined;
  CrossPillarClients: { focus?: 'search' } | undefined;
  CrossPillarClientDetail: { email: string; name: string };
  CrossPillarMessages: undefined;
  CrossPillarAssignments: undefined;
};

const Stack = createNativeStackNavigator<CrossPillarStackParamList>();

export default function CrossPillarNavigator() {
  const { colors } = useTheme();
  const currentUser = useCurrentUser();

  // The user object may not carry coach_practice_type directly (the
  // existing useCurrentUser hook hydrates from /auth/me which returns a
  // narrow shape). Fetch the practice type explicitly on mount; cache
  // for the session.
  const [practiceType, setPracticeType] = useState<CoachPracticeType | null | 'loading'>('loading');

  useEffect(() => {
    let alive = true;
    practiceTypeApi
      .get()
      .then(({ data }) => {
        if (alive) setPracticeType(data.practice_type ?? null);
      })
      .catch(() => {
        // Treat fetch failure as "not selected" so the picker still
        // renders; the user can recover by selecting and saving.
        if (alive) setPracticeType(null);
      });
    return () => {
      alive = false;
    };
  }, [currentUser?.id]);

  const initialRoute = useMemo<keyof CrossPillarStackParamList>(() => {
    if (practiceType === 'both') return 'CrossPillarHome';
    return 'PracticeSelection';
  }, [practiceType]);

  if (practiceType === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      key={initialRoute}
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="PracticeSelection"
        component={PracticeSelectionScreen}
        initialParams={{ current: practiceType }}
      />
      <Stack.Screen name="CrossPillarHome" component={CrossPillarHomeScreen} />
      <Stack.Screen name="CrossPillarClients" component={CrossPillarClientsListScreen} />
      <Stack.Screen name="CrossPillarClientDetail" component={CrossPillarClientDetailScreen} />
      <Stack.Screen name="CrossPillarMessages" component={CrossPillarMessagesScreen} />
      <Stack.Screen name="CrossPillarAssignments" component={CrossPillarAssignmentsScreen} />
    </Stack.Navigator>
  );
}
