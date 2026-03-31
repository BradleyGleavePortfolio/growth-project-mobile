import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen from '../screens/client/HomeScreen';
import HabitsScreen from '../screens/client/HabitsScreen';
import LogScreen from '../screens/client/LogScreen';
import PlanScreen from '../screens/client/PlanScreen';
import RecipesScreen from '../screens/client/RecipesScreen';
import ProgressScreen from '../screens/client/ProgressScreen';
import FastingScreen from '../screens/client/FastingScreen';
import ProfileScreen from '../screens/client/ProfileScreen';
import SettingsScreen from '../screens/client/SettingsScreen';
import ReportScreen from '../screens/client/ReportScreen';
import WidgetsScreen from '../screens/client/WidgetsScreen';
import WorkoutScreen from '../screens/client/WorkoutScreen';
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import RoutineBuilderScreen from '../screens/client/RoutineBuilderScreen';
import CoachGuidelinesScreen from '../screens/client/CoachGuidelinesScreen';
import NotificationsScreen from '../screens/client/NotificationsScreen';
import EducationScreen from '../screens/client/EducationScreen';
import CommunityScreen from '../screens/client/CommunityScreen';
import { Colors } from '../constants/colors';

export type HomeStackParamList = {
  HomeMain: undefined;
  Habits: undefined;
  Notifications: undefined;
};

export type ClientTabParamList = {
  Home: undefined;
  Log: undefined;
  Plan: undefined;
  Recipes: undefined;
  Progress: undefined;
  Fast: undefined;
  WorkoutTab: undefined;
  Community: undefined;
  ProfileStack: undefined;
};

export type WorkoutStackParamList = {
  WorkoutMain: undefined;
  ActiveWorkout: { routineId?: string; routineName: string; exercises: string };
  RoutineBuilder: { routineId?: string } | undefined;
  CoachGuidelines: undefined;
};

export type ProfileStackParamList = {
  ProfileMain: undefined;
  Settings: undefined;
  Widgets: undefined;
  Report: undefined;
  Learn: undefined;
};

const Tab = createBottomTabNavigator<ClientTabParamList>();
const HomeStackNav = createNativeStackNavigator<HomeStackParamList>();
const WorkoutStackNav = createNativeStackNavigator<WorkoutStackParamList>();
const ProfileStackNav = createNativeStackNavigator<ProfileStackParamList>();

function HomeStackNavigator() {
  return (
    <HomeStackNav.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <HomeStackNav.Screen name="HomeMain" component={HomeScreen} />
      <HomeStackNav.Screen name="Habits" component={HabitsScreen} />
      <HomeStackNav.Screen name="Notifications" component={NotificationsScreen} />
    </HomeStackNav.Navigator>
  );
}

function WorkoutStackNavigator() {
  return (
    <WorkoutStackNav.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <WorkoutStackNav.Screen name="WorkoutMain" component={WorkoutScreen} />
      <WorkoutStackNav.Screen name="ActiveWorkout" component={ActiveWorkoutScreen} />
      <WorkoutStackNav.Screen name="RoutineBuilder" component={RoutineBuilderScreen} />
      <WorkoutStackNav.Screen name="CoachGuidelines" component={CoachGuidelinesScreen} />
    </WorkoutStackNav.Navigator>
  );
}

function ProfileStackNavigator() {
  return (
    <ProfileStackNav.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <ProfileStackNav.Screen name="ProfileMain" component={ProfileScreen} />
      <ProfileStackNav.Screen name="Settings" component={SettingsScreen} />
      <ProfileStackNav.Screen name="Widgets" component={WidgetsScreen} />
      <ProfileStackNav.Screen name="Report" component={ReportScreen} />
      <ProfileStackNav.Screen name="Learn" component={EducationScreen} />
    </ProfileStackNav.Navigator>
  );
}

export default function ClientNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarShowLabel: true,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'ios' ? 8 : 8,
          paddingTop: 4,
          height: 64,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Log"
        component={LogScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Plan"
        component={PlanScreen}
        options={{
          tabBarLabel: 'Plan',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Recipes"
        component={RecipesScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="restaurant-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Progress"
        component={ProgressScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Fast"
        component={FastingScreen}
        options={{
          tabBarLabel: 'Fast',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="timer-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="WorkoutTab"
        component={WorkoutStackNavigator}
        options={{
          tabBarLabel: 'Workout',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="barbell-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Community"
        component={CommunityScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileStack"
        component={ProfileStackNavigator}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
