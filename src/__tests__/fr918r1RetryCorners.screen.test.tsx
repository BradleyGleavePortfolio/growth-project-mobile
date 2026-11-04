/**
 * FR-918R1 (LO-918 C1). Exercise details' Retry (shown when the details fail
 * to load) has the app's button corners (radius.button), like every other
 * filled action.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.mock('../ui/skeletons/Skeleton', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  return {
    __esModule: true,
    SkeletonScreen: (props: { testID?: string }) => ReactLib.createElement(View, { testID: props.testID }),
  };
});
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false, addListener: () => ({ remove: () => undefined }) }),
  VideoView: 'VideoView',
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: require('../theme/tokens').lightTokens }),
}));
jest.mock('../services/api', () => {
  const get = jest.fn();
  return { __esModule: true, default: { get, defaults: { baseURL: 'http://test.local/api' } }, get };
});

import api from '../services/api';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import { radius } from '../theme/tokens';
import type { WorkoutStackParamList } from '../navigation/ClientNavigator';

const Stack = createNativeStackNavigator<WorkoutStackParamList>();

it('Retry has the button corners', async () => {
  (api.get as jest.Mock).mockRejectedValue({ response: { status: 500 } });
  const view = await render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} initialParams={{ idOrSlug: '0025' }} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  const button = await view.findByRole('button', { name: 'Retry' });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ borderRadius: radius.button, minHeight: 44 });
});
