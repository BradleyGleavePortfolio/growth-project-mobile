/**
 * S-MWB — the coach "Programs" tab (EXPO_PUBLIC_FF_MWB_PROGRAMS): master
 * program library, week x day editor, saved workouts, bulk assign, add to
 * package and history. The existing CoachWorkoutBuilder is registered here so
 * a program day opens the same builder (with autosave when that flag is on).
 */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ProgramsLibraryScreen from "../screens/coach/programs/ProgramsLibraryScreen";
import ProgramEditorScreen from "../screens/coach/programs/ProgramEditorScreen";
import ProgramFormScreen from "../screens/coach/programs/ProgramFormScreen";
import ProgramDayPickerScreen from "../screens/coach/programs/ProgramDayPickerScreen";
import ProgramAssignScreen from "../screens/coach/programs/ProgramAssignScreen";
import ProgramPackagesScreen from "../screens/coach/programs/ProgramPackagesScreen";
import ProgramHistoryScreen from "../screens/coach/programs/ProgramHistoryScreen";
import CoachWorkoutBuilderScreen from "../screens/coach/CoachWorkoutBuilderScreen";
import SupportInboxScreen from "../screens/support/SupportInboxScreen";
import type { ProgramsStackParamList } from "../screens/coach/programs/types";

const Stack = createNativeStackNavigator<ProgramsStackParamList>();

export default function ProgramsStackNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ProgramsLibrary"
        component={ProgramsLibraryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProgramEditor"
        component={ProgramEditorScreen}
        options={{ title: "Program" }}
      />
      <Stack.Screen
        name="ProgramForm"
        component={ProgramFormScreen}
        options={{ title: "New program" }}
      />
      <Stack.Screen
        name="ProgramDayPicker"
        component={ProgramDayPickerScreen}
        options={{ title: "Fill day" }}
      />
      <Stack.Screen
        name="ProgramAssign"
        component={ProgramAssignScreen}
        options={{ title: "Assign program" }}
      />
      <Stack.Screen
        name="ProgramPackages"
        component={ProgramPackagesScreen}
        options={{ title: "Add to package" }}
      />
      <Stack.Screen
        name="ProgramHistory"
        component={ProgramHistoryScreen}
        options={{ title: "History and clients" }}
      />
      <Stack.Screen
        name="CoachWorkoutBuilder"
        component={CoachWorkoutBuilderScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SupportInbox"
        component={SupportInboxScreen}
        options={{ title: "Support" }}
      />
    </Stack.Navigator>
  );
}
