// REDO-INSETS-133 (agent 133): Edit workout's top bar starts insets.top + 12
// under the status bar on both phones, not at a fixed 56 that sits too low on
// Android edge-to-edge and too tight under an iPhone notch.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { layout } from '../theme/tokens';
import WorkoutHistoryEditScreen from '../screens/client/WorkoutHistoryEditScreen';

const mockWorkout = {
  id: 'saved-workout', workout_name: 'Push A', notes: '',
  exercises: [{ exercise_name: 'Bench Press', muscle_group: 'chest', sets_completed: 1, weight_per_set: [135], reps_per_set: [8] }],
};
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { workout: JSON.stringify(mockWorkout) } }),
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../theme/tokens').lightTokens,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens }),
}));
jest.mock('../services/api', () => ({ __esModule: true, default: { put: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];

it.each(DEVICES)('puts the Edit workout bar insets.top + 12 under the status bar on $name', async (d) => {
  const s = await render(
    <SafeAreaProvider initialMetrics={{ frame: d.frame, insets: d.insets }}><WorkoutHistoryEditScreen /></SafeAreaProvider>,
  );
  expect(StyleSheet.flatten(s.getByTestId('workout-history-edit-top').props.style).paddingTop).toBe(d.insets.top + layout.statusBarGap);
  expect(s.getByLabelText('Cancel workout editing')).toBeTruthy();
  expect(s.getByLabelText('Save workout changes')).toBeTruthy();
});
