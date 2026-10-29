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
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CommunityTermsGate from '../components/community/CommunityTermsGate';
import { Colors } from '../theme';
import { colors as tokenColors } from '../theme/tokens';
import { featureFlags } from '../config/featureFlags';
import { LightTheme } from '../theme/ThemeProvider';
import CoachCommunityHomeScreen from '../screens/community/CoachCommunityHomeScreen';
import CoachCommunityInboxScreen from '../screens/community/CoachCommunityInboxScreen';
import CoachCommunityCohortsScreen from '../screens/community/CoachCommunityCohortsScreen';
import CoachCommunityCohortDetailScreen from '../screens/community/CoachCommunityCohortDetailScreen';
import CoachCommunityPostDetailScreen from '../screens/community/CoachCommunityPostDetailScreen';
import CoachCommunityModerationScreen from '../screens/community/CoachCommunityModerationScreen';
import CoachCommunityEventsScreen from '../screens/community/CoachCommunityEventsScreen';
import CommunityWearablePromptsScreen from '../screens/community/CommunityWearablePromptsScreen';
import CommunityVoiceNoteDetail from '../screens/community/CommunityVoiceNoteDetail';
import type { CoachCommunityStackParamList } from '../screens/community/coachCommunityNavTypes';

const CoachCommunityStack =
  createNativeStackNavigator<CoachCommunityStackParamList>();

/** The K2 pages are drawn light (bone, cream): their themed parts stay light on a dark phone. */
const K2_ROUTES: ReadonlySet<string> = new Set([
  'CoachCommunityHome',
  'CoachCommunityInbox',
  'CoachCommunityCohorts',
  'CoachCommunityCohortDetail',
]);

export function coachCommunityScreenLayout({
  route,
  children,
}: {
  route: { name: string };
  children: React.ReactElement;
}): React.ReactElement {
  return K2_ROUTES.has(route.name) ? <LightTheme>{children}</LightTheme> : children;
}

/**
 * Apple 1.2 (B-IOSREV-2): the whole stack sits behind the one-time community
 * terms agreement, so a deep link or push into any Community route asks first.
 */
export default function CoachCommunityNavigator(): React.ReactElement {
  const navigation = useNavigation();
  return (
    <CommunityTermsGate onBack={featureFlags.coachTabsV2 ? () => navigation.goBack() : undefined}>
      <CoachCommunityNavigatorStack />
    </CommunityTermsGate>
  );
}

function CoachCommunityNavigatorStack(): React.ReactElement {
  return (
    <CoachCommunityStack.Navigator
      screenLayout={coachCommunityScreenLayout}
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
        options={({ navigation }) => ({
          title: 'Community',
          // K2: the page draws its serif title; the bar keeps only the back control.
          headerTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: tokenColors.bone },
          // COACHTABS: with the six tabs Community opens from Messages, so its
          // first page has a Back (44 pt) to the tab the coach came from.
          ...(featureFlags.coachTabsV2 ? {
            headerLeft: () => (
              <Pressable
                onPress={() => navigation.goBack()}
                style={{ width: 44, height: 44, justifyContent: 'center' }}
                accessibilityRole="button"
                accessibilityLabel="Back"
                testID="community-back"
              >
                <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
              </Pressable>
            ),
          } : {}),
        })}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityInbox"
        component={CoachCommunityInboxScreen}
        // K2: the page draws its serif title; the bar keeps only the back control.
        options={{
          title: 'Inbox',
          headerTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: tokenColors.bone },
        }}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityCohorts"
        component={CoachCommunityCohortsScreen}
        // K2 (#172-10, as the inbox): the page draws its serif title.
        options={{
          title: 'Cohorts',
          headerTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: tokenColors.bone },
        }}
      />
      <CoachCommunityStack.Screen
        name="CoachCommunityCohortDetail"
        component={CoachCommunityCohortDetailScreen}
        // K2: the page draws the cohort's name as its serif title.
        options={{
          title: 'Cohort',
          headerTitle: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: tokenColors.bone },
        }}
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
      {/* VOICE-INBOX: a voice row in the inbox opens its note here. */}
      {featureFlags.communityVoiceNotes ? (
        <CoachCommunityStack.Screen
          name="CommunityVoiceNoteDetail"
          component={CommunityVoiceNoteDetail}
          // One header: the note draws its own "Voice note" title, so the bar
          // keeps only the back control, in the page colour with no shadow —
          // no second, empty bar above the title.
          options={{
            title: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: tokenColors.bone },
          }}
        />
      ) : null}
    </CoachCommunityStack.Navigator>
  );
}
