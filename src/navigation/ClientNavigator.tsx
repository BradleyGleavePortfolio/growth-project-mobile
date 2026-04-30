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
 */
import React from 'react';
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
import { colors } from '../theme/tokens';

// ─── Param lists ──────────────────────────────────────────────────────────────

export type HomeStackParamList = {
  HomeMain: undefined;
  Habits: undefined;
  Notifications: undefined;
  Messages: undefined;
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
  Preferences: undefined;
  AIGuide:     undefined;
  Membership:  undefined;
};

// ─── Stack navigators ─────────────────────────────────────────────────────────

const Tab           = createBottomTabNavigator<ClientTabParamList>();
const HomeStackNav  = createNativeStackNavigator<HomeStackParamList>();
const WorkoutStackNav = createNativeStackNavigator<WorkoutStackParamList>();
const MoreStackNav  = createNativeStackNavigator<MoreStackParamList>();

function HomeStackNavigator() {
  return (
    <HomeStackNav.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bone },
      }}
    >
      <HomeStackNav.Screen name="HomeMain"       component={HomeScreen} />
      <HomeStackNav.Screen name="Habits"         component={HabitsScreen} />
      <HomeStackNav.Screen name="Notifications"  component={NotificationsScreen} />
      <HomeStackNav.Screen name="Messages"       component={MessagesScreen} />
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
      <MoreStackNav.Screen name="Preferences"  component={PreferencesScreen} />
      <MoreStackNav.Screen name="AIGuide"      component={AIGuideScreen} />
      <MoreStackNav.Screen name="Membership"   component={MembershipScreen} />
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
