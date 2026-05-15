/**
 * ClientNavigator — Wave 3: 4-tab bar, icons-only, hairline divider.
 *
 * Tabs: Home / Train (Workout) / Coach (Log+Plan) / Profile (More)
 * - `tabBarShowLabel: false` — no labels
 * - Hairline 0.5px top divider (stone color)
 * - Height 64, bone background
 * - Ionicons outline, size 24, no badges
 *
 * Nav structure preserved: all existing screen names remain valid.
 *
 * Phase 7B: TimelineScreen added to MoreStackNavigator as 'Timeline'.
 * Accessible from MoreScreen; no new tab added (avoids 5-tab crowding).
 * Phase 7C: LeaderboardScreen + LeaderboardSettingsScreen added to MoreStack.
 * Bloodwork: BloodworkEntryScreen added to MoreStack (flag OFF by default).
 * Wave 11: ClientPathCopilotScreen + PrivateCommunityHubScreen added to MoreStack.
 * Phase 11 Track 9: SupportInboxScreen added to MoreStack (Crisp support inbox).
 * Sessions: SessionsUpcoming, SessionRequest, SessionPrepare added to MoreStack.
 * Phase 9: Bell icon in HomeStack header routes to NotificationCenter.
 *   NotificationCenter and NotificationPreferences added to HomeStackParamList.
 */
import React, { useEffect, useState } from 'react';
import { AppState, TouchableOpacity, View } from 'react-native';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen from '../screens/client/HomeScreen';
import HabitsScreen from '../screens/client/HabitsScreen';
import LogScreen from '../screens/client/LogScreen';
import PlanScreen from '../screens/client/PlanScreen';
import RecipesScreen from '../screens/client/RecipesScreen';
import RecipeDetailScreen from '../screens/client/RecipeDetailScreen';
import GroceryListScreen from '../screens/client/GroceryListScreen';
import ShoppingListScreen from '../screens/client/ShoppingListScreen';
import PrepGuideScreen from '../screens/client/PrepGuideScreen';
import ProgressScreen from '../screens/client/ProgressScreen';
import FastingScreen from '../screens/client/FastingScreen';
import ProfileScreen from '../screens/client/ProfileScreen';
import EditProfileScreen from '../screens/client/EditProfileScreen';
import SettingsScreen from '../screens/client/SettingsScreen';
import DeleteAccountScreen from '../screens/settings/DeleteAccountScreen';
import ReportScreen from '../screens/client/ReportScreen';
import WidgetsScreen from '../screens/client/WidgetsScreen';
import WorkoutScreen from '../screens/client/WorkoutScreen';
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import RoutineBuilderScreen from '../screens/client/RoutineBuilderScreen';
import CoachGuidelinesScreen from '../screens/client/CoachGuidelinesScreen';
import NotificationsScreen from '../screens/client/NotificationsScreen';
import MessagesScreen from '../screens/client/MessagesScreen';
import EducationScreen from '../screens/client/EducationScreen';
import CommunityScreen from '../screens/client/CommunityScreen';
import MoreScreen from '../screens/client/MoreScreen';
import TrustCenterScreen from '../screens/TrustCenterScreen';
import PreferencesScreen from '../screens/client/PreferencesScreen';
import AIGuideScreen from '../screens/client/AIGuideScreen';
import MembershipScreen from '../screens/client/MembershipScreen';
// Phase 7B — Transformation Timeline
import TimelineScreen from '../screens/client/TimelineScreen';
// Phase 7C — Peer Leaderboard
import LeaderboardScreen from '../screens/client/LeaderboardScreen';
import LeaderboardSettingsScreen from '../screens/client/LeaderboardSettingsScreen';
// Bloodwork — client-entered labs (flag OFF by default)
import BloodworkEntryScreen from '../screens/client/BloodworkEntryScreen';
// Wave 11 — runtime scaffolding (flag-gated; safe to mount)
import ClientPathCopilotScreen from '../screens/client/ClientPathCopilotScreen';
import PrivateCommunityHubScreen from '../screens/client/PrivateCommunityHubScreen';
import { HapticService } from '../ui/haptics/haptics.service';
// Phase 11 — Share Card
import ShareCardScreen from '../screens/share/ShareCardScreen';
import type { ShareCardMilestone } from '../screens/share/ShareCardScreen';
// Phase 11 — Notification Preferences (category-level: settings/)
import NotificationCategoryPreferencesScreen from '../screens/settings/NotificationPreferencesScreen';
// Phase 11 Track 9 — Support Inbox (Crisp)
import SupportInboxScreen from '../screens/support/SupportInboxScreen';
// Sprint B-2 — client surfaces from PR #130 wired here.
import ClientMacrosScreen from '../screens/client/ClientMacrosScreen';
// Concierge Phase 1 — scheduling client surfaces.
import ClientBookingRequestScreen from '../screens/client/ClientBookingRequestScreen';
import ClientUpcomingSessionsScreen from '../screens/client/ClientUpcomingSessionsScreen';
// Payments — checkout surface for a coach's package share link.
import PackageCheckoutScreen from '../screens/client/PackageCheckoutScreen';
import ClientDailyMealPlanScreen from '../screens/client/ClientDailyMealPlanScreen';
import ClientWorkoutViewerScreen from '../screens/client/ClientWorkoutViewerScreen';
// Phase 9 — Notification center
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import NotificationPreferencesScreen from '../screens/notifications/NotificationPreferencesScreen';
import NotificationBadge from '../components/NotificationBadge';
import { fetchUnreadCount } from '../services/notificationsApi';
// Phase 10 — GDPR Article 20 data portability
import DataExportScreen from '../screens/settings/DataExportScreen';
import { colors } from '../theme/tokens';

// ─── Param lists ──────────────────────────────────────────────────────────────

export type HomeStackParamList = {
  HomeMain: undefined;
  Habits: undefined;
  /** Legacy stub — kept for backward-compat; routes resolve to NotificationCenter. */
  Notifications: undefined;
  Messages: undefined;
  /** Phase 9 — Global notification center. */
  NotificationCenter: undefined;
  /** Phase 9 — Notification preferences. */
  NotificationPreferences: undefined;
};

// Wave 3: 4 tabs — Home / Train / Coach / Profile
export type ClientTabParamList = {
  Home:       undefined;
  WorkoutTab: undefined;  // Train
  Log:        undefined;  // Coach (Log+Plan hub — keeps Log screen for food logging)
  MoreTab:    undefined;  // Profile / More
};

export type WorkoutStackParamList = {
  WorkoutMain: undefined;
  ActiveWorkout: { routineId?: string; routineName: string; exercises: string };
  RoutineBuilder: { routineId?: string } | undefined;
  CoachGuidelines: undefined;
};

// MoreStack: all non-tab screens live here. Screen names preserved.
// Phase 7B: Timeline added.
// Phase 7C: Leaderboard + LeaderboardSettings added.
// Bloodwork: BloodworkEntry added (flag OFF by default).
// Wave 11: Copilot + PrivateCommunityHub added (flag-gated).
export type MoreStackParamList = {
  MoreIndex:   undefined;
  Recipes:     undefined;
  RecipeDetail: { recipeId: string };
  Fast:        undefined;
  Community:   undefined;
  Progress:    undefined;
  ProfileMain: undefined;
  EditProfile: undefined;
  Settings:    undefined;
  Widgets:     undefined;
  Report:      undefined;
  Learn:       undefined;
  GroceryList: undefined;
  ShoppingList: undefined;
  PrepGuide:   undefined;
  Plan:        undefined;
  TrustCenter: undefined;
  DeleteAccount: undefined;
  Preferences: undefined;
  AIGuide:     undefined;
  Membership:  undefined;
  /** Phase 7B — Transformation Timeline */
  Timeline:    undefined;
  /** Phase 7C — Peer Leaderboard (opt-in) */
  Leaderboard:         undefined;
  LeaderboardSettings: undefined;
  /** Bloodwork — client-entered labs (flag OFF by default) */
  Bloodwork:   undefined;
  /** Wave 11 — gated routes; screens render a preview-only empty state when flag is OFF. */
  Copilot:           undefined;
  PrivateCommunityHub: undefined;
  /** Phase 11 — Share Card. Entry point: milestone/streak detection adds a Share button. */
  ShareCard: { milestone: ShareCardMilestone };
  /** Phase 11 — Notification category preferences. Entry: Settings > Notifications > Categories. */
  NotificationPreferences: undefined;
  /** Phase 11 Track 9 — Crisp support inbox. */
  SupportInbox:      undefined;
  /** Sprint B-2 — client-facing read surfaces over Sprint B v2 backend. */
  ClientMacros:        undefined;
  ClientDailyMealPlan: { date?: string } | undefined;
  ClientWorkoutViewer: { assignmentId: string };
  /** Concierge Phase 1 — scheduling client surfaces. */
  ClientBookingRequest:    undefined;
  ClientUpcomingSessions:  undefined;
  /** Phase 10 — GDPR Article 20 data portability */
  DataExport: undefined;
  /** Client-facing checkout for a coach's package share link. */
  PackageCheckout: { shareToken: string };
};

// ─── Phase 9: unread count polling for the bell icon ─────────────────────────

function useClientUnreadCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const n = await fetchUnreadCount();
        if (mounted) setCount(n);
      } catch {
        // Silent — badge shows stale count on error.
      }
    };
    refresh();
    const interval = setInterval(refresh, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      mounted = false;
      clearInterval(interval);
      sub.remove();
    };
  }, []);
  return count;
}

// ─── Stack navigators ─────────────────────────────────────────────────────────

const Tab           = createBottomTabNavigator<ClientTabParamList>();
const HomeStackNav  = createNativeStackNavigator<HomeStackParamList>();
const WorkoutStackNav = createNativeStackNavigator<WorkoutStackParamList>();
const MoreStackNav  = createNativeStackNavigator<MoreStackParamList>();

function HomeStackNavigator() {
  const unreadCount = useClientUnreadCount();
  return (
    <HomeStackNav.Navigator
      screenOptions={({ navigation }) => ({
        headerShown: false,
        contentStyle: { backgroundColor: colors.bone },
        // Phase 9: bell icon injected into every screen in the Home stack.
        // We use a custom header right rather than showing the header title,
        // so each screen continues to render its own title.
        headerRight: () => (
          <TouchableOpacity
            onPress={() => navigation.navigate('NotificationCenter')}
            style={styles.bellButton}
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0
                ? `Notifications, ${unreadCount > 99 ? '99+' : unreadCount} unread`
                : 'Notifications'
            }
          >
            <View style={styles.bellWrap}>
              <Ionicons name="notifications-outline" size={24} color={colors.ink} />
              <NotificationBadge count={unreadCount} />
            </View>
          </TouchableOpacity>
        ),
      })}
    >
      <HomeStackNav.Screen name="HomeMain"              component={HomeScreen} />
      <HomeStackNav.Screen name="Habits"                component={HabitsScreen} />
      <HomeStackNav.Screen name="Notifications"         component={NotificationsScreen} />
      <HomeStackNav.Screen name="Messages"              component={MessagesScreen} />
      {/* Phase 9 — Notification center screens */}
      <HomeStackNav.Screen
        name="NotificationCenter"
        component={NotificationCenterScreen}
        options={{ headerShown: false }}
      />
      <HomeStackNav.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ headerShown: false }}
      />
    </HomeStackNav.Navigator>
  );
}

function WorkoutStackNavigator() {
  return (
    <WorkoutStackNav.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bone },
      }}
    >
      <WorkoutStackNav.Screen name="WorkoutMain"     component={WorkoutScreen} />
      <WorkoutStackNav.Screen name="ActiveWorkout"   component={ActiveWorkoutScreen} />
      <WorkoutStackNav.Screen name="RoutineBuilder"  component={RoutineBuilderScreen} />
      <WorkoutStackNav.Screen name="CoachGuidelines" component={CoachGuidelinesScreen} />
    </WorkoutStackNav.Navigator>
  );
}

// MoreStack: Profile + every ex-tab screen. Keeps existing navigate() calls valid.
// Phase 7B: Timeline screen registered here.
// Phase 7C: Leaderboard screens registered here.
// Bloodwork: BloodworkEntry screen registered here.
// Wave 11: Copilot + CommunityHub registered here (flags default OFF in prod).
function MoreStackNavigator() {
  return (
    <MoreStackNav.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bone },
      }}
    >
      <MoreStackNav.Screen name="MoreIndex"    component={MoreScreen} />
      <MoreStackNav.Screen name="ProfileMain"  component={ProfileScreen} />
      <MoreStackNav.Screen name="EditProfile"  component={EditProfileScreen} />
      <MoreStackNav.Screen name="Recipes"      component={RecipesScreen} />
      <MoreStackNav.Screen name="RecipeDetail" component={RecipeDetailScreen} />
      <MoreStackNav.Screen name="GroceryList"  component={GroceryListScreen} />
      <MoreStackNav.Screen name="ShoppingList" component={ShoppingListScreen} />
      <MoreStackNav.Screen name="PrepGuide"    component={PrepGuideScreen} />
      <MoreStackNav.Screen name="Fast"         component={FastingScreen} />
      <MoreStackNav.Screen name="Community"    component={CommunityScreen} />
      <MoreStackNav.Screen name="Progress"     component={ProgressScreen} />
      <MoreStackNav.Screen name="Settings"     component={SettingsScreen} />
      <MoreStackNav.Screen name="Widgets"      component={WidgetsScreen} />
      <MoreStackNav.Screen name="Report"       component={ReportScreen} />
      <MoreStackNav.Screen name="Learn"        component={EducationScreen} />
      <MoreStackNav.Screen name="Plan"         component={PlanScreen} />
      <MoreStackNav.Screen name="TrustCenter"  component={TrustCenterScreen} />
      <MoreStackNav.Screen name="DeleteAccount" component={DeleteAccountScreen} />
      <MoreStackNav.Screen name="Preferences"  component={PreferencesScreen} />
      <MoreStackNav.Screen name="AIGuide"      component={AIGuideScreen} />
      <MoreStackNav.Screen name="Membership"   component={MembershipScreen} />
      {/* Phase 7B — Transformation Timeline */}
      <MoreStackNav.Screen name="Timeline"     component={TimelineScreen} />
      {/* Phase 7C — Peer Leaderboard (opt-in) */}
      <MoreStackNav.Screen name="Leaderboard"          component={LeaderboardScreen} />
      <MoreStackNav.Screen name="LeaderboardSettings"  component={LeaderboardSettingsScreen} />
      {/* Bloodwork — client-entered labs (flag OFF by default) */}
      <MoreStackNav.Screen name="Bloodwork"    component={BloodworkEntryScreen} />
      {/* Wave 11 — gated routes; the screens themselves render a
          preview-only empty state when their flag is OFF. */}
      <MoreStackNav.Screen name="Copilot"           component={ClientPathCopilotScreen} />
      <MoreStackNav.Screen name="PrivateCommunityHub" component={PrivateCommunityHubScreen} />
      {/* Phase 11 — Share Card. Rendered off-screen; captureRef then opens native share sheet. */}
      <MoreStackNav.Screen name="ShareCard" component={ShareCardScreen} />
      {/* Phase 11 — Notification category preferences (push taxonomy). */}
      <MoreStackNav.Screen name="NotificationPreferences" component={NotificationCategoryPreferencesScreen} />
      {/* Phase 11 Track 9 — Support Inbox */}
      <MoreStackNav.Screen name="SupportInbox"      component={SupportInboxScreen} />
      {/* Sprint B-2 final wave — client read surfaces. The screens
          themselves shipped in PR #130 (this PR adds the wiring).
          Reachable via deep-link and from MoreScreen entries (added
          in a follow-up; route registration first so deep-links
          work today). */}
      <MoreStackNav.Screen name="ClientMacros"        component={ClientMacrosScreen} />
      <MoreStackNav.Screen name="ClientDailyMealPlan" component={ClientDailyMealPlanScreen} />
      <MoreStackNav.Screen name="ClientWorkoutViewer" component={ClientWorkoutViewerScreen} />
      {/* Concierge Phase 1 — scheduling client surfaces. */}
      <MoreStackNav.Screen
        name="ClientBookingRequest"
        component={ClientBookingRequestScreen}
      />
      <MoreStackNav.Screen
        name="ClientUpcomingSessions"
        component={ClientUpcomingSessionsScreen}
      />
      {/* Phase 10 — GDPR Article 20 data portability */}
      <MoreStackNav.Screen name="DataExport" component={DataExportScreen} />
      {/* Client-facing checkout for a coach's package share link. Reachable
          via deep-link (tgp://p/:token, https://app.trygrowthproject.com/p/:token)
          and from the MembershipScreen. */}
      <MoreStackNav.Screen
        name="PackageCheckout"
        component={PackageCheckoutScreen}
        options={{ presentation: 'modal' }}
      />
    </MoreStackNav.Navigator>
  );
}

// ─── Main tab navigator ───────────────────────────────────────────────────────

export default function ClientNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor:   colors.ink,
        tabBarInactiveTintColor: colors.stone,
        tabBarStyle: {
          backgroundColor: colors.bone,
          borderTopWidth: 0.5,
          borderTopColor: colors.stone,
          height: 64,
        },
      }}
      screenListeners={{
        tabPress: () => {
          // Phase 11 / Track 3: haptic selection feedback on tab switch
          HapticService.selection();
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStackNavigator}
        options={{
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="WorkoutTab"
        component={WorkoutStackNavigator}
        options={{
          tabBarAccessibilityLabel: 'Train',
          tabBarIcon: ({ color }) => (
            <Ionicons name="fitness-outline" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Log"
        component={LogScreen}
        options={{
          tabBarAccessibilityLabel: 'Log food',
          tabBarIcon: ({ color }) => (
            <Ionicons name="restaurant-outline" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        options={{
          tabBarAccessibilityLabel: 'Profile and more',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-outline" size={24} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bellButton: {
    marginRight: 16,
    padding: 4,
  },
  bellWrap: {
    position: 'relative',
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
