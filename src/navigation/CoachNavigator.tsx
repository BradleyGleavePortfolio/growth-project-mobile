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
import { Colors } from '../constants/colors';

export type CoachTabParamList = {
  ClientsStack: undefined;
  Dashboard: undefined;
  Templates: undefined;
  Messages: undefined;
  Settings: undefined;
};

export type ClientsStackParamList = {
  ClientsList: undefined;
  ClientDetail: { clientId: string; clientName: string };
  ClientMessages: { clientId: string; clientName: string };
  InviteCodes: undefined;
};

const Tab = createBottomTabNavigator<CoachTabParamList>();
const ClientsStack = createNativeStackNavigator<ClientsStackParamList>();

function ClientsStackNavigator() {
  return (
    <ClientsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <ClientsStack.Screen name="ClientsList" component={ClientsListScreen} />
      <ClientsStack.Screen name="ClientDetail" component={ClientDetailScreen} />
      <ClientsStack.Screen name="ClientMessages" component={ClientMessagesScreen} />
      <ClientsStack.Screen name="InviteCodes" component={InviteCodesScreen} />
    </ClientsStack.Navigator>
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
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
