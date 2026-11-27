// DEEP-LINK-GUARD-M: what a member sees when a link with malformed %-encoding
// reaches the app's real link receiver (Dependabot alerts 78 and 28). A real
// NavigationContainer runs the app's own `linking` over a stand-in auth stack
// with AuthNavigator's route names. Made-up values only.
import React from 'react';
import { Linking } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Copied from linkingConfig.test.ts so importing `linking` stays cheap.
jest.mock('../AuthNavigator', () => () => null);
jest.mock('../ClientNavigator', () => () => null);
jest.mock('../CoachNavigator', () => () => null);
jest.mock('../OnboardingNavigator', () => () => null);
jest.mock('../../components/OfflineBanner', () => () => null);
jest.mock('../../screens/client/Day1WinScreen', () => () => null);
jest.mock('../../services/support/crisp.service', () => ({
  initCrisp: jest.fn(),
  syncCrispIdentity: jest.fn(),
}));
jest.mock('../../services/firstWinApi', () => ({
  firstWinApi: { getStatus: jest.fn(), markComplete: jest.fn() },
  WinType: {},
}));
jest.mock('../../services/authActions', () => ({ signOut: jest.fn() }));
jest.mock('../../hooks/useLeanOnboardingReconcile', () => ({
  useLeanOnboardingReconcile: () => {},
}));
jest.mock('../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../screenshots', () => ({ isScreenshotMode: () => false }));

import { linking } from '../RootNavigator';

// AuthNavigator.tsx's route names, in its order (Welcome is the first screen).
const AUTH_ROUTES = [
  'Welcome',
  'Login',
  'CreateAccount',
  'ForgotPassword',
  'ResetPassword',
  'RoleSelection',
  'AcceptInvite',
  'AuthCallback',
  'EmailVerified',
  'SupportInbox',
];

const MALFORMED = '%ff';
const Stack = createNativeStackNavigator();
const Empty = () => null;

async function mountAuthStack() {
  const navigation = createNavigationContainerRef<ParamListBase>();
  await render(
    <NavigationContainer ref={navigation} linking={{ ...linking }}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {AUTH_ROUTES.map((name) => (
          <Stack.Screen key={name} name={name} component={Empty} />
        ))}
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  return navigation;
}

function captureUrlListener() {
  let emit: ((event: { url: string }) => void) | undefined;
  const spy = jest.spyOn(Linking, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (event: { url: string }) => void,
  ) => {
    emit = handler;
    return { remove: jest.fn() };
  }) as never);
  return { spy, emit: (url: string) => emit?.({ url }) };
}

describe('a link with malformed %-encoding leaves the app where it was', () => {
  it('D1 control: a real cold-start link opens its screen', async () => {
    const initial = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('tgp://login');
    try {
      const navigation = await mountAuthStack();
      expect(navigation.getCurrentRoute()?.name).toBe('Login');
    } finally {
      initial.mockRestore();
    }
  });

  it('D1: a cold-start link with malformed %-encoding opens the usual first screen with nothing from the link', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue(`tgp://welcome?x=${MALFORMED}`);
    try {
      const navigation = await mountAuthStack();
      const route = navigation.getCurrentRoute();
      const landedClean = route?.name === 'Welcome' && route.params === undefined;
      expect(landedClean).toBe(true);
      const errorLogged = errors.mock.calls.length > 0;
      expect(errorLogged).toBe(false);
    } finally {
      initial.mockRestore();
      errors.mockRestore();
    }
  });

  it('D2: an open-app link with malformed %-encoding leaves the screen on view, and a real link still opens', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const initial = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
    const listener = captureUrlListener();
    try {
      const navigation = await mountAuthStack();
      await act(async () => {
        navigation.navigate('Login');
      });
      expect(navigation.getCurrentRoute()?.name).toBe('Login');

      await act(async () => {
        listener.emit(
          `tgp://reset-password#access_token=${MALFORMED}&refresh_token=r1&type=recovery`,
        );
      });
      const stayed = navigation.getCurrentRoute()?.name === 'Login';
      expect(stayed).toBe(true);
      const errorLogged = errors.mock.calls.length > 0;
      expect(errorLogged).toBe(false);

      await act(async () => {
        listener.emit('tgp://reset-password#access_token=hdr1.body2.sig3&refresh_token=r1Ab&type=recovery');
      });
      const route = navigation.getCurrentRoute();
      expect(route?.name).toBe('ResetPassword');
      expect(route?.params).toEqual({
        access_token: 'hdr1.body2.sig3',
        refresh_token: 'r1Ab',
        type: 'recovery',
      });
    } finally {
      listener.spy.mockRestore();
      initial.mockRestore();
      errors.mockRestore();
    }
  });
});
