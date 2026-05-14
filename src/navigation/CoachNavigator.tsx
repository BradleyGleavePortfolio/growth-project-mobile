// Phase 9: Bell icon + NotificationCenter added to CoachNavigator.
// All existing routes preserved.
import React, { useEffect, useState } from 'react';
import { AppState, TouchableOpacity, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../services/api';
import ClientsListScreen from '../screens/coach/ClientsListScreen';
import CoachHomeScreen from '../screens/coach/CoachHomeScreen';
import MessagesScreen from '../screens/coach/MessagesScreen';
import SettingsScreen from '../screens/coach/SettingsScreen';
import ClientDetailScreen from '../screens/coach/ClientDetailScreen';
import ProgramTemplatesScreen from '../screens/coach/ProgramTemplatesScreen';
import InviteCodesScreen from '../screens/coach/InviteCodesScreen';
import ClientMessagesScreen from '../screens/coach/ClientMessagesScreen';
import RiskBoardScreen from '../screens/coach/RiskBoardScreen';
import ClientRiskDetailScreen from '../screens/coach/ClientRiskDetailScreen';
import CoachBillingScreen from '../screens/coach/CoachBillingScreen';
import BloodworkReviewQueueScreen from '../screens/coach/BloodworkReviewQueueScreen';
import TrustCenterScreen from '../screens/TrustCenterScreen';
// Wave 11 — runtime scaffolding (flag-gated; safe to mount)
import CoachBriefScreen from '../screens/coach/CoachBriefScreen';
import AdminControlRoomScreen from '../screens/coach/AdminControlRoomScreen';
// Stage 2 (finance OS parity) — placeholder for the cross-pillar coach view.
// Read-only, no API call. Stage 3 replaces this with a nested navigator.
import BothPillarsScreen from '../screens/coach/BothPillarsScreen';
// Stage 3 — cross-pillar federated coach surface. Mounted as a nested
// navigator so the practice-selection picker, dashboard, roster, detail
// view, messages, and assignments all live under one settings entry.
import CrossPillarNavigator from '../screens/coach/cross-pillar/CrossPillarNavigator';
// Phase 11 Track 9 — Support Inbox (Crisp)
import SupportInboxScreen from '../screens/support/SupportInboxScreen';
// Phase 11 / Track 7 — sub-coach team management (Scale+ tier gate enforced in-screen)
import TeamManagementScreen from '../screens/coach/TeamManagementScreen';
import SubCoachDetailScreen from '../screens/coach/SubCoachDetailScreen';
import ClientReassignModal from '../screens/coach/ClientReassignModal';
// Sprint B-2 — coach surfaces. Macros review (PR #130), workout
// builder + meal templates + bulk invite (this PR).
import CoachMacrosReviewScreen from '../screens/coach/CoachMacrosReviewScreen';
import CoachWorkoutBuilderScreen from '../screens/coach/CoachWorkoutBuilderScreen';
import CoachMealTemplatesScreen from '../screens/coach/CoachMealTemplatesScreen';
import CoachBulkInviteScreen from '../screens/coach/CoachBulkInviteScreen';
// Email Pipeline v1 — bulk-invite + invites list (per-recipient delivery view).
// These complement the legacy CoachBulkInviteScreen / InviteCodesScreen;
// the v1 surfaces target the email-delivery contract on
// feat/email-pipeline-v1-backend.
import BulkInviteScreen from '../screens/coach/BulkInviteScreen';
import CoachInvitesScreen from '../screens/coach/CoachInvitesScreen';
// Concierge Phase 1 — scheduling coach surfaces.
import CoachAvailabilityEditorScreen from '../screens/coach/CoachAvailabilityEditorScreen';
import CoachBookingInboxScreen from '../screens/coach/CoachBookingInboxScreen';
// Coach AI v1 — generate/edit/approve workout, meal, insight drafts per client.
import AIWorkoutDraftScreen from '../screens/coach/AIWorkoutDraftScreen';
import AIMealPlanDraftScreen from '../screens/coach/AIMealPlanDraftScreen';
import ClientInsightScreen from '../screens/coach/ClientInsightScreen';
// Phase 10 — GDPR right to erasure.
import DeleteAccountScreen from '../screens/settings/DeleteAccountScreen';
// Phase 9 — Notification center
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import NotificationPreferencesScreen from '../screens/notifications/NotificationPreferencesScreen';
import NotificationBadge from '../components/NotificationBadge';
import { fetchUnreadCount } from '../services/notificationsApi';
// Phase 8 — Coach Command Center. This is the new top-level coach landing.
// The legacy CoachHomeScreen is preserved in the Clients stack as a sub-screen
// so existing deep links and navigation.navigate() calls keep working.
import CommandCenterScreen from '../screens/coach/command-center/CommandCenterScreen';
import { __USING_MOCK_DATA } from '../services/commandCenterApi';
// Phase 10 — GDPR Article 20 data portability
import DataExportScreen from '../screens/settings/DataExportScreen';
import { Colors } from '../constants/colors';

export type CoachTabParamList = {
  // Phase 8: Command Center replaces the old top-level Dashboard tab.
  // The 'Dashboard' name is kept in the param list so any existing
  // navigate('Dashboard') calls in the codebase don't break.
  CommandCenter: undefined;
  ClientsStack: undefined;
  Templates: undefined;
  Messages: undefined;
  SettingsStack: undefined;
  TeamStack: undefined;
};

export type ClientsStackParamList = {
  ClientsList: undefined;
  ClientDetail: { clientId: string; clientName: string };
  /**
   * `initialDraft` is consumed by ClientMessagesScreen to prefill the
   * composer — used by Coach AI v1's "Send check-in" action on the
   * weekly insight screen. Optional and ignored on screens that don't
   * support it.
   */
  ClientMessages: { clientId: string; clientName: string; initialDraft?: string };
  InviteCodes: undefined;
  RiskBoard: undefined;
  ClientRiskDetail: { userId: string; clientName?: string };
  BloodworkReviewQueue: undefined;
  // Sprint B-2 coach surfaces — closed by this PR.
  CoachMacrosReview:    { clientId: string; clientName: string };
  CoachWorkoutBuilder:  { planId?: string } | undefined;
  CoachMealTemplates:   undefined;
  CoachBulkInvite:      undefined;
  /** Email Pipeline v1 — bulk invite v2 surface (per-recipient delivery). */
  BulkInvite:           undefined;
  /** Email Pipeline v1 — invites list with delivery + resend / revoke. */
  CoachInvites:         undefined;
  /** Concierge Phase 1 — scheduling coach surfaces. */
  CoachAvailabilityEditor:  { coachId: string };
  CoachBookingInbox:        undefined;
  /** Coach AI v1 — review/edit/approve AI-generated workout program draft. */
  AIWorkoutDraft:  { draftId: string; clientId: string; clientName: string };
  /** Coach AI v1 — review/edit/approve AI-generated meal plan draft. */
  AIMealPlanDraft: { draftId: string; clientId: string; clientName: string };
  /** Coach AI v1 — render an AI-generated weekly insight for a client. */
  ClientInsight:   { draftId: string; clientId: string; clientName: string };
  /** Phase 9 — Global notification center. */
  NotificationCenter: undefined;
  /** Phase 9 — Notification preferences. */
  NotificationPreferences: undefined;
  // Phase 8 — Legacy landing — kept so existing navigate('Dashboard') calls resolve.
  Dashboard: undefined;
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  Billing: undefined;
  TrustCenter: undefined;
  // Wave 11 — runtime scaffolding (flag-gated; safe to mount).
  CoachBrief: undefined;
  AdminControlRoom: undefined;
  // Phase 11 Track 9 — Crisp support inbox.
  SupportInbox: undefined;
  // Stage 3 — cross-pillar coach view. Now hosts the full nested navigator.
  BothPillars: undefined;
  // Legacy stub kept reachable for QA but not surfaced in normal nav.
  BothPillarsLegacyStub: undefined;
  // Phase 10 — GDPR right to erasure.
  DeleteAccount: undefined;
  /** Phase 10 — GDPR Article 20 data portability */
  DataExport: undefined;
};

/** Phase 11 / Track 7 — team management stack param list. */
export type TeamStackParamList = {
  TeamManagement: undefined;
  SubCoachDetail: { subCoachId: string; subCoachName: string };
  ClientReassign: { clientId: string; clientName: string; fromSubCoachId: string };
};

const Tab = createBottomTabNavigator<CoachTabParamList>();
const ClientsStack = createNativeStackNavigator<ClientsStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();
const TeamStack = createNativeStackNavigator<TeamStackParamList>();

// ─── Phase 9: unread count polling for the coach bell icon ───────────────────

function useCoachNotificationUnreadCount(): number {
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

function ClientsStackNavigator() {
  const notifUnread = useCoachNotificationUnreadCount();
  return (
    <ClientsStack.Navigator
      screenOptions={({ navigation }) => ({
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        // Phase 9: bell icon in every screen in the Clients stack.
        headerRight: () => (
          <TouchableOpacity
            onPress={() => navigation.navigate('NotificationCenter')}
            style={styles.bellButton}
            accessibilityRole="button"
            accessibilityLabel={
              notifUnread > 0
                ? `Notifications, ${notifUnread > 99 ? '99+' : notifUnread} unread`
                : 'Notifications'
            }
          >
            <View style={styles.bellWrap}>
              <Ionicons name="notifications-outline" size={24} color={Colors.textPrimary} />
              <NotificationBadge count={notifUnread} />
            </View>
          </TouchableOpacity>
        ),
      })}
    >
      <ClientsStack.Screen name="ClientsList"       component={ClientsListScreen} />
      <ClientsStack.Screen name="ClientDetail"      component={ClientDetailScreen} />
      <ClientsStack.Screen name="ClientMessages"    component={ClientMessagesScreen} />
      <ClientsStack.Screen name="InviteCodes"       component={InviteCodesScreen} />
      <ClientsStack.Screen name="RiskBoard"         component={RiskBoardScreen} />
      <ClientsStack.Screen name="ClientRiskDetail"  component={ClientRiskDetailScreen} />
      <ClientsStack.Screen name="BloodworkReviewQueue" component={BloodworkReviewQueueScreen} />
      {/* Phase 8: legacy CoachHomeScreen demoted to sub-screen so existing
          navigate('Dashboard') deep links keep resolving. The home tab is
          now CommandCenter. */}
      <ClientsStack.Screen name="Dashboard"         component={CoachHomeScreen} />
      {/* Sprint B-2 final wave — register coach surfaces under
          ClientsStack so navigation.navigate('CoachMacrosReview', {...})
          works from ClientDetailScreen and ClientsListScreen. */}
      <ClientsStack.Screen
        name="CoachMacrosReview"
        component={CoachMacrosReviewScreen}
      />
      <ClientsStack.Screen
        name="CoachWorkoutBuilder"
        component={CoachWorkoutBuilderScreen}
      />
      <ClientsStack.Screen
        name="CoachMealTemplates"
        component={CoachMealTemplatesScreen}
      />
      <ClientsStack.Screen
        name="CoachBulkInvite"
        component={CoachBulkInviteScreen}
      />
      {/* Email Pipeline v1 — v2 bulk invite surface + invites list. */}
      <ClientsStack.Screen
        name="BulkInvite"
        component={BulkInviteScreen}
      />
      <ClientsStack.Screen
        name="CoachInvites"
        component={CoachInvitesScreen}
      />
      {/* Concierge Phase 1 — scheduling coach surfaces. */}
      <ClientsStack.Screen
        name="CoachAvailabilityEditor"
        component={CoachAvailabilityEditorScreen}
      />
      <ClientsStack.Screen
        name="CoachBookingInbox"
        component={CoachBookingInboxScreen}
      />
      {/* Coach AI v1 — companion routes for the per-client generate/edit/approve flow. */}
      <ClientsStack.Screen
        name="AIWorkoutDraft"
        component={AIWorkoutDraftScreen}
      />
      <ClientsStack.Screen
        name="AIMealPlanDraft"
        component={AIMealPlanDraftScreen}
      />
      <ClientsStack.Screen
        name="ClientInsight"
        component={ClientInsightScreen}
      />
      {/* Phase 9 — Notification center screens */}
      <ClientsStack.Screen
        name="NotificationCenter"
        component={NotificationCenterScreen}
        options={{ headerShown: false }}
      />
      <ClientsStack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ headerShown: false }}
      />
    </ClientsStack.Navigator>
  );
}

function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <SettingsStack.Screen name="SettingsHome" component={SettingsScreen} />
      <SettingsStack.Screen name="Billing"      component={CoachBillingScreen} />
      <SettingsStack.Screen name="TrustCenter"  component={TrustCenterScreen} />
      {/* Wave 11 — gated routes. Each screen renders a preview-only empty
          state when its flag is OFF. */}
      <SettingsStack.Screen name="CoachBrief" component={CoachBriefScreen} />
      <SettingsStack.Screen name="AdminControlRoom" component={AdminControlRoomScreen} />
      {/* Phase 11 Track 9 — Support Inbox */}
      <SettingsStack.Screen name="SupportInbox" component={SupportInboxScreen} />
      {/* Stage 3 — cross-pillar federated coach surface. The Stage-2
          BothPillarsScreen stub is preserved as a reachable fallback if
          the nested navigator ever fails to mount, but the live entry
          point is the nested navigator below. */}
      <SettingsStack.Screen name="BothPillars" component={CrossPillarNavigator} />
      {/* Reachable for QA/regression; not navigated to in normal flow. */}
      <SettingsStack.Screen name="BothPillarsLegacyStub" component={BothPillarsScreen} />
      {/* Phase 10 — GDPR right to erasure. */}
      <SettingsStack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
      {/* Phase 10 — GDPR Article 20 data portability */}
      <SettingsStack.Screen name="DataExport" component={DataExportScreen} />
    </SettingsStack.Navigator>
  );
}

/**
 * TeamStackNavigator
 *
 * Phase 11 / Track 7. Scale+ tier gate is enforced inside TeamManagementScreen
 * so it is safe to mount for all coaches — non-Scale coaches see an upgrade
 * prompt rather than the roster.
 */
function TeamStackNavigator() {
  return (
    <TeamStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <TeamStack.Screen name="TeamManagement" component={TeamManagementScreen} />
      <TeamStack.Screen name="SubCoachDetail" component={SubCoachDetailScreen} />
      <TeamStack.Screen
        name="ClientReassign"
        component={ClientReassignModal}
        options={{ presentation: 'modal' }}
      />
    </TeamStack.Navigator>
  );
}

function useCoachUnreadPolling(): number {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const res = await coachApi.getUnreadCounts();
        if (!mounted) return;
        setTotal(Number(res.data?.total ?? 0));
      } catch {
        // Silent — retry on next tick.
      }
    };
    refresh();
    const id = setInterval(refresh, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      mounted = false;
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return total;
}

export default function CoachNavigator() {
  const unreadCount = useCoachUnreadPolling();
  // Audit P0: while the Command Center API still ships only mock data
  // (__USING_MOCK_DATA driven by EXPO_PUBLIC_USE_MOCK_COMMAND_CENTER), the
  // initial tab for a real coach is ClientsStack. Mock-mode builds (demo,
  // screenshots) keep the CommandCenter landing surface.
  const initialTab = __USING_MOCK_DATA ? 'CommandCenter' : 'ClientsStack';
  return (
    <Tab.Navigator
      initialRouteName={initialTab}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: 4,
          paddingTop: 4,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
        },
      }}
    >
      {/* Phase 8: Command Center is the new home tab. */}
      <Tab.Screen
        name="CommandCenter"
        component={CommandCenterScreen}
        options={{
          tabBarLabel: 'Overview',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ClientsStack"
        component={ClientsStackNavigator}
        options={{
          tabBarLabel: 'Clients',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Templates"
        component={ProgramTemplatesScreen}
        options={{
          tabBarLabel: 'Templates',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        options={{
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble" size={size} color={color} />
          ),
        }}
      />
      {/* Phase 11 / Track 7 — Team tab. Scale+ tier gate enforced in-screen. */}
      <Tab.Screen
        name="TeamStack"
        component={TeamStackNavigator}
        options={{
          tabBarLabel: 'Team',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-circle" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsStack"
        component={SettingsStackNavigator}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

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
