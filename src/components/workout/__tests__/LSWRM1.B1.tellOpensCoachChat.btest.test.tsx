/**
 * LS-WRM-1 B1 (B-TEST, growth-project-mobile#1000 @ 5e563c75): Tell <coach> on the refused-workout card, and on its
 * sheet, opens the coach chat.
 *
 * Real installed navigators (bottom tabs + native stack), registered the way src/navigation/ClientNavigator.tsx
 * registers them: the card is on WorkoutMain (WorkoutStackNav, tab "WorkoutTab") and the coach chat "Messages" is on
 * HomeStackNav (tab "Home"). The registration is read from ClientNavigator.tsx, so this file follows it if it moves.
 * REACHABLE RULE (src/__tests__/rowRoutes.test.tsx, @react-navigation/core 7): a bare navigate(name) runs on the
 * current navigator and bubbles up; it never goes down into a sibling tab's stack. The engine and the signed-in
 * person are faked; RefusedWorkoutCard is the real one.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RefusedWorkout } from '../../../offline/sync/sync-engine';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockList = jest.fn(async (..._a: unknown[]): Promise<RefusedWorkout[]> => []);
jest.mock('../../../offline/sync/sync-engine', () => {
  const { EventEmitter } = jest.requireActual('events');
  return {
    listRefusedWorkouts: (...a: unknown[]) => mockList(...a),
    sendRefusedWorkoutAgain: jest.fn(async () => 'sent'),
    removeRefusedWorkout: jest.fn(async () => undefined),
    deadLetterEvents: new EventEmitter(),
    workoutSyncEvents: new EventEmitter(),
  };
});
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', coach_id: 'k1' }) }));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'k1', name: 'Sam Rivera' }] }) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { error: jest.fn(), success: jest.fn() } }));

import RefusedWorkoutCard from '../RefusedWorkoutCard';

const refused: RefusedWorkout = {
  id: 'a',
  body: {
    date: '2026-10-10', workout_name: 'Upper body B', workout_type: 'strength', duration_minutes: 48, notes: '',
    exercises: [{ exercise_name: 'Bench press', sets_completed: 3, reps_per_set: [8, 8, 8], weight_per_set: [145, 145, 145] }],
  },
  refusal: {
    status: 400, code: 'WORKOUT_INVALID', said: 'property surprise should not exist',
    nextStep: 'If an app update is waiting, install it, then send it again.',
  },
};

// Which client stack registers the coach chat, read from the navigator itself.
const navigatorSource = fs.readFileSync(path.join(__dirname, '../../../navigation/ClientNavigator.tsx'), 'utf8');
const registers = (stack: string, name: string) => new RegExp(`<${stack}\\.Screen\\s+name="${name}"`).test(navigatorSource);
const chatOnHome = registers('HomeStackNav', 'Messages');
const chatOnWorkout = registers('WorkoutStackNav', 'Messages');

const Tab = createBottomTabNavigator<ParamListBase>();
const HomeStackNav = createNativeStackNavigator<ParamListBase>();
const WorkoutStackNav = createNativeStackNavigator<ParamListBase>();
const ref = createNavigationContainerRef<ParamListBase>();

const HomeMain = () => <Text>Home</Text>;
const CoachChat = () => <Text>Coach chat</Text>;
const WorkoutMain = () => <RefusedWorkoutCard />;

function HomeStack() {
  return (
    <HomeStackNav.Navigator screenOptions={{ headerShown: false }}>
      <HomeStackNav.Screen name="HomeMain" component={HomeMain} />
      {chatOnHome ? <HomeStackNav.Screen name="Messages" component={CoachChat} /> : null}
    </HomeStackNav.Navigator>
  );
}
function WorkoutStack() {
  return (
    <WorkoutStackNav.Navigator screenOptions={{ headerShown: false }}>
      <WorkoutStackNav.Screen name="WorkoutMain" component={WorkoutMain} />
      {chatOnWorkout ? <WorkoutStackNav.Screen name="Messages" component={CoachChat} /> : null}
    </WorkoutStackNav.Navigator>
  );
}

async function openTrainTab() {
  mockList.mockResolvedValue([refused]);
  const view = await render(
    <NavigationContainer ref={ref}>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Home" component={HomeStack} />
        <Tab.Screen name="WorkoutTab" component={WorkoutStack} />
      </Tab.Navigator>
    </NavigationContainer>,
  );
  await act(async () => { ref.navigate('WorkoutTab'); });
  await waitFor(() => expect(view.getByTestId('refused-card-tell')).toBeTruthy());
  expect(ref.getCurrentRoute()?.name).toBe('WorkoutMain');
  return view;
}

describe('LS-WRM-1 B1: Tell <coach> on a refused workout opens the coach chat (KT-3, no dead tap)', () => {
  let errors: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    // An unhandled navigate is only a console.error in a dev build and nothing at all in a release build.
    errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('the coach chat is registered on one client stack (the premise this file mirrors)', () => {
    expect(chatOnHome || chatOnWorkout).toBe(true);
  });

  it('from the card on the Train tab', async () => {
    const view = await openTrainTab();
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-tell')); });
    await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('Messages'));
  });

  it('from the sheet (the sheet closes and the chat opens)', async () => {
    const view = await openTrainTab();
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    await act(async () => { fireEvent.press(view.getByTestId('refused-sheet-tell')); });
    await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('Messages'));
    expect(view.queryByTestId('refused-sheet')).toBeNull();
  });
});
