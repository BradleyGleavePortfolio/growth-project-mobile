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
import RecipeDetailScreen from '../screens/client/RecipeDetailScreen';
import GroceryListScreen from '../screens/client/GroceryListScreen';
import ShoppingListScreen from '../screens/client/ShoppingListScreen';
import PrepGuideScreen from '../screens/client/PrepGuideScreen';
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
import MessagesScreen from '../screens/client/MessagesScreen';
import EducationScreen from '../screens/client/EducationScreen';
import CommunityScreen from '../screens/client/CommunityScreen';
import MoreScreen from '../screens/client/MoreScreen';
import { Colors } from '../constants/colors';

export type HomeStackParamList = {
  HomeMain: undefined;
  Habits: undefined;
  Notifications: undefined;
  Messages: undefined;
};

// Round 3: reduced bottom tabs from 9 → 5 (iOS HIG cap).
// Recipes / Fast / Community / Profile / Settings / Widgets / Report / Learn now live
// in the "More" stack tab.
export type ClientTabParamList = {
  Home: undefined;
  Log: undefined;
  Plan: undefined;
  WorkoutTab: undefined;
  MoreTab: undefined;
};

export type WorkoutStackParamList = {
  WorkoutMain: undefined;
  ActiveWorkout: { routineId?: string; routineName: string; exercises: string };
  RoutineBuilder: { routineId?: string } | undefined;
  CoachGuidelines: undefined;
};

// MoreStack holds every screen that used to be a top-level tab
// (Recipes, Fast, Community, Progress) plus everything that used to live in
// the ProfileStack. Screen names preserved so existing `navigate('Settings')` etc.
// calls from ProfileScreen / HomeScreen keep working verbatim.
export type MoreStackParamList = {
  MoreIndex: undefined;
  Recipes: undefined;
  RecipeDetail: { recipe: any };
  Fast: undefined;
  Community: undefined;
  Progress: undefined;
  ProfileMain: undefined;
  Settings: undefined;
  Widgets: undefined;
  Report: undefined;
  Learn: undefined;
  GroceryList: undefined;
  ShoppingList: undefined;
  PrepGuide: undefined;
};

const Tab = createBottomTabNavigator<ClientTabParamList>();
const HomeStackNav = createNativeStackNavigator<HomeStackParamList>();
const WorkoutStackNav = createNativeStackNavigator<WorkoutStackParamList>();
const MoreStackNav = createNativeStackNavigator<MoreStackParamList>();

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
      <HomeStackNav.Screen name="Messages" component={MessagesScreen} />
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

// Round 3: MoreStack contains ex-tabs and old ProfileStack screens.
// Keeps existing navigation targets ('Settings', 'Report', 'Widgets', 'Learn',
// 'ProfileMain') valid — only the parent tab changes.
function MoreStackNavigator() {
  return (
    <MoreStackNav.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <MoreStackNav.Screen name="MoreIndex" component={MoreScreen} />
      <MoreStackNav.Screen name="Recipes" component={RecipesScreen} />
      <MoreStackNav.Screen name="RecipeDetail" component={RecipeDetailScreen} />
      <MoreStackNav.Screen name="GroceryList" component={GroceryListScreen} />
      <MoreStackNav.Screen name="ShoppingList" component={ShoppingListScreen} />
      <MoreStackNav.Screen name="PrepGuide" component={PrepGuideScreen} />
      <MoreStackNav.Screen name="Fast" component={FastingScreen} />
      <MoreStackNav.Screen name="Community" component={CommunityScreen} />
      <MoreStackNav.Screen name="Progress" component={ProgressScreen} />
      <MoreStackNav.Screen name="ProfileMain" component={ProfileScreen} />
      <MoreStackNav.Screen name="Settings" component={SettingsScreen} />
      <MoreStackNav.Screen name="Widgets" component={WidgetsScreen} />
      <MoreStackNav.Screen name="Report" component={ReportScreen} />
      <MoreStackNav.Screen name="Learn" component={EducationScreen} />
    </MoreStackNav.Navigator>
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
      {/* Round 3: each tab now has accessibilityLabel so VoiceOver / TalkBack
          announce the destination rather than "tab, 1 of 5, selected". */}
      <Tab.Screen
        name="Home"
        component={HomeStackNavigator}
        options={{
          tabBarAccessibilityLabel: 'Home tab',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Log"
        component={LogScreen}
        options={{
          tabBarAccessibilityLabel: 'Log food tab',
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
          tabBarAccessibilityLabel: 'Meal plan tab',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="WorkoutTab"
        component={WorkoutStackNavigator}
        options={{
          tabBarLabel: 'Workout',
          tabBarAccessibilityLabel: 'Workout tab',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="barbell-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        options={{
          tabBarLabel: 'More',
          tabBarAccessibilityLabel: 'More tab — recipes, progress, community, profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
