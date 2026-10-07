import React from 'react';
import { AxiosHeaders } from 'axios';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ExerciseLibraryScreen from '../ExerciseLibraryScreen';
import { exerciseCatalogApi } from '../../../api/exerciseCatalog';
import { darkTokens, lightTokens } from '../../../theme/tokens';
import type { WorkoutStackParamList } from '../../../navigation/ClientNavigator';

let mockColorScheme: 'light' | 'dark' = 'dark';
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../../../theme/tokens')[`${mockColorScheme}Tokens`] }),
}));
jest.mock('../../../api/exerciseCatalog', () => ({ exerciseCatalogApi: { list: jest.fn() } }));

const list = jest.mocked(exerciseCatalogApi.list);
const Stack = createNativeStackNavigator<WorkoutStackParamList>();
const renderLibrary = () => render(
  <NavigationContainer><Stack.Navigator><Stack.Screen name="ExerciseLibrary"
    component={ExerciseLibraryScreen} /></Stack.Navigator></NavigationContainer>,
);

beforeEach(() => {
  mockColorScheme = 'dark';
  list.mockReset();
  list.mockResolvedValue({
    data: { items: [], nextCursor: null, total: 0 }, status: 200, statusText: 'OK',
    headers: {}, config: { headers: new AxiosHeaders() },
  });
});
describe('exercise library contrast', () => {
  it.each(['light', 'dark'] as const)('uses readable underlined text filters in %s appearance', async (scheme) => {
    mockColorScheme = scheme;
    const tokens = scheme === 'dark' ? darkTokens : lightTokens;
    const view = await renderLibrary();
    await waitFor(() => expect(view.getByText('No exercises match.')).toBeTruthy());
    await fireEvent.press(view.getByRole('button', { name: 'cardio' }));
    expect(StyleSheet.flatten(view.getByText('cardio').props.style).color).toBe(tokens.textPrimary);
    expect(StyleSheet.flatten(view.getByRole('button', { name: 'cardio' }).props.style))
      .toMatchObject({ minHeight: 44, borderBottomColor: tokens.textPrimary });
  });

  it('uses the readable accent foreground for a load error in dark appearance', async () => {
    list.mockRejectedValue(new Error('Cannot load exercises. Check the connection.'));
    const view = await renderLibrary();
    const error = await view.findByText('Exercises did not load. Check your connection and try again.');
    expect(StyleSheet.flatten(error.props.style).color).toBe(darkTokens.accentText);
  });
});
