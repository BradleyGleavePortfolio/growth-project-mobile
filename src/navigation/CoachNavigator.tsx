import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
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
import CoachAvailabilityScreen from '../screens/coach/CoachAvailabilityScreen';
import CoachSessionRequestsScreen from '../screens/coach/CoachSessionRequestsScreen';
import CoachUpcomingCallsScreen from '../screens/coach/CoachUpcomingCallsScreen';
import CoachSessionBriefScreen from '../screens/coach/CoachSessionBriefScreen';
// Wave 11 — runtime scaffolding (flag-gated; safe to mount)
import CoachBriefScreen from '../screens/coach/CoachBriefScreen';
import AdminControlRoomScreen from '../screens/coach/AdminControlRoomScreen';
// Stage 2 (finance OS parity) — placeholder for the cross-pillar coach view.
// Read-only, no API call. Stage 3 wires the federated roster fetch.
import BothPillarsScreen from '../screens/coach/BothPillarsScreen';
// Phase 11 Track 9 — Support Inbox (Crisp)
import SupportInboxScreen from '../screens/support/SupportInboxScreen';
// Phase 11 / Track 7 — sub-coach team management (Scale+ tier gate enforced in-screen)
import TeamManagementScreen from '../screens/coach/TeamManagementScreen';
import SubCoachDetailScreen from '../screens/coach/SubCoachDetailScreen';
import ClientReassignModal from '../screens/coach/ClientReassignModal';
import { Colors } from '../constants/colors';

export type CoachTabParamList = {
  ClientsStack: undefined;
  Dashboard: undefined;
  Templates: undefined;
  Messages: undefined;
  SettingsStack: undefined;
  TeamStack: undefined;
};

export type ClientsStackParamList = {
  ClientsList: undefined;
  ClientDetail: { clientId: string; clientName: string };
  ClientMessages: { clientId: string; clientName: string };
  InviteCodes: undefined;
  RiskBoard: undefined;
  ClientRiskDetail: { userId: string; clientName?: string };
  BloodworkReviewQueue: undefined;
  // Sessions screens — coach-facing coaching call surfaces.
  CoachSessionRequests:  { coachId: string };
  CoachUpcomingCalls:    { coachId: string };
  CoachAvailability:     { coachId: string };
  CoachSessionBrief:     { sessionId: string };
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
  // Stage 2 (finance OS parity) — cross-pillar coach view stub.
  BothPillars: undefined;
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

function ClientsStackNavigator() {
  return (
    <ClientsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <ClientsStack.Screen name="ClientsList"       component={ClientsListScreen} />
      <ClientsStack.Screen name="ClientDetail"      component={ClientDetailScreen} />
      <ClientsStack.Screen name="ClientMessages"    component={ClientMessagesScreen} />
      <ClientsStack.Screen name="InviteCodes"       component={InviteCodesScreen} />
      <ClientsStack.Screen name="RiskBoard"         component={RiskBoardScreen} />
      <ClientsStack.Screen name="ClientRiskDetail"  component={ClientRiskDetailScreen} />
      <ClientsStack.Screen name="BloodworkReviewQueue" component={BloodworkReviewQueueScreen} />
      {/* Sessions — coaching call surfaces. Flags default OFF; screens show
          calm placeholders when the backend is not yet deployed. */}
      <ClientsStack.Screen
        name="CoachSessionRequests"
        component={CoachSessionRequestsScreen}
      />
      <ClientsStack.Screen
        name="CoachUpcomingCalls"
        component={CoachUpcomingCallsScreen}
      />
      <ClientsStack.Screen
        name="CoachAvailability"
        component={CoachAvailabilityScreen}
      />
      <ClientsStack.Screen
        name="CoachSessionBrief"
        component={CoachSessionBriefScreen}
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
      {/* Stage 2 (finance OS parity) — cross-pillar stub. Stage 3 wires
          the federated roster fetch that backs this screen. */}
      <SettingsStack.Screen name="BothPillars" component={BothPillarsScreen} />
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
  return (
    <Tab.Navigator
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
        name="Dashboard"
        component={CoachHomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
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
