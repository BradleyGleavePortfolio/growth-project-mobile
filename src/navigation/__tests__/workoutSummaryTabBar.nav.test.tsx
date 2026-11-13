/**
 * FIX-974R1 (LS-974R1 B1, found by the round's renders): the tab bar rule must hold with the real navigators.
 * react-navigation hands screenOptions the tab route without its stack's state, so a rule that reads `route.state`
 * never fires in the app even though it passes on hand-made routes. This mounts a real tab navigator over a real
 * stack, with ClientNavigator's call, and opens and closes the summary the way ActiveWorkoutScreen does (setParams).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { summaryHidesTabBar } from '../workoutSummaryTabBar';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const ref = createNavigationContainerRef();
const Nothing = () => null;
const LogTab = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="WorkoutMain" component={Nothing} />
    <Stack.Screen name="ActiveWorkout" component={Nothing} />
  </Stack.Navigator>
);

const mount = (activeWorkoutOpen: boolean) => render(
  <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
    <NavigationContainer ref={ref} initialState={{ index: 1, routes: [
      { name: 'Today' },
      { name: 'Log', state: { index: activeWorkoutOpen ? 1 : 0, routes: [
        { name: 'WorkoutMain' },
        ...(activeWorkoutOpen ? [{ name: 'ActiveWorkout', params: { routineName: 'Upper body A' } }] : []),
      ] } },
    ] }}>
      <Tab.Navigator
        screenOptions={({ route, navigation }) => ({
          headerShown: false,
          tabBarButtonTestID: `tab-${route.name}`,
          // ClientNavigator.tsx's call, word for word.
          tabBarStyle: [{ height: 98 }, summaryHidesTabBar(route, navigation) && { display: 'none' }],
        })}
      >
        <Tab.Screen name="Today" component={Nothing} />
        <Tab.Screen name="Log" component={LogTab} />
      </Tab.Navigator>
    </NavigationContainer>
  </SafeAreaInsetsContext.Provider>,
);

// The bar is hidden when the button or one of its ancestors is display: none.
const barHidden = () => {
  type Node = { props: { style?: unknown }; parent: Node | null };
  for (let n: Node | null = screen.getByTestId('tab-Log') as unknown as Node; n; n = n.parent) {
    if ((StyleSheet.flatten(n.props.style as never) as { display?: string } | undefined)?.display === 'none') return true;
  }
  return false;
};
const setActiveWorkoutParams = (params: object) => act(() => {
  ref.dispatch({ type: 'SET_PARAMS', payload: { params }, source: ref.getCurrentRoute()?.key } as never);
});

it('hides the bar while the live workout shows its summary, and brings it back when the summary closes', () => {
  mount(true);
  expect(ref.getCurrentRoute()?.name).toBe('ActiveWorkout');
  expect(barHidden()).toBe(false);

  setActiveWorkoutParams({ summary: true });
  expect(barHidden()).toBe(true);

  setActiveWorkoutParams({ summary: false });
  expect(barHidden()).toBe(false);
});

it('brings the bar back when the client leaves the summary for Train', () => {
  mount(true);
  setActiveWorkoutParams({ summary: true });
  expect(barHidden()).toBe(true);

  act(() => { ref.goBack(); });
  expect(ref.getCurrentRoute()?.name).toBe('WorkoutMain');
  expect(barHidden()).toBe(false);
});

it('keeps the bar on Train with no workout open', () => {
  mount(false);
  expect(barHidden()).toBe(false);
});
