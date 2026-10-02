import React from 'react';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { healthConnectEnabled: false } } },
}));
const mockOauth = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useStartOauth: () => ({ mutateAsync: mockOauth, isPending: false }),
  useInvalidateWearableConnections: () => mockInvalidate,
}));
const mockConnect = jest.fn();
jest.mock('../../../../services/health/onDeviceConnect', () => ({
  connectOnDeviceProvider: (...args: unknown[]) => mockConnect(...args),
}));

import ConnectProviderSheet from '../ConnectProviderSheet';
import { HEALTH_CONNECT_DISABLED_MESSAGE } from '../../../../config/healthConnect';
import { subscribeTutorialSignals } from '../../../../tutorial/tutorialEvents';
import type { TutorialSignal } from '../../../../tutorial/types';

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  Object.defineProperty(Constants, 'expoConfig', {
    configurable: true,
    value: { extra: { healthConnectEnabled: false } },
  });
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: originalOS,
  });
});

test.each(['HEALTH_CONNECT', 'SAMSUNG_HEALTH'] as const)(
  'OFF %s sheet explains the update and offers a working Close, not a permission CTA',
  async (provider) => {
    const onClose = jest.fn();
    const onConnected = jest.fn();
    await render(
      <ConnectProviderSheet
        provider={provider}
        visible
        onClose={onClose}
        onConnected={onConnected}
      />,
    );
    expect(screen.getByText(HEALTH_CONNECT_DISABLED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Continue')).toBeNull();
    expect(screen.queryByText(/Continue to grant access/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockOauth).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  },
);

test('ON keeps the existing Android connect flow', async () => {
  Object.defineProperty(Constants, 'expoConfig', {
    configurable: true,
    value: { extra: { healthConnectEnabled: true } },
  });
  mockConnect.mockResolvedValue('granted');
  const onClose = jest.fn();
  await render(
    <ConnectProviderSheet
      provider="HEALTH_CONNECT"
      visible
      onClose={onClose}
    />,
  );
  await fireEvent.press(
    screen.getByLabelText('Continue connecting Health Connect'),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mockConnect).toHaveBeenCalledWith('HEALTH_CONNECT');
  expect(mockInvalidate).toHaveBeenCalledTimes(1);
});

test('disabled service result never reports a successful connection or tutorial completion', async () => {
  Object.defineProperty(Constants, 'expoConfig', {
    configurable: true,
    value: { extra: { healthConnectEnabled: true } },
  });
  mockConnect.mockResolvedValue('disabled');
  const signals: TutorialSignal[] = [];
  const unsubscribe = subscribeTutorialSignals((signal) =>
    signals.push(signal),
  );
  const onClose = jest.fn();
  const onConnected = jest.fn();
  try {
    await render(
      <ConnectProviderSheet
        provider="HEALTH_CONNECT"
        visible
        onClose={onClose}
        onConnected={onConnected}
      />,
    );
    await fireEvent.press(
      screen.getByLabelText('Continue connecting Health Connect'),
    );
    await waitFor(() =>
      expect(screen.getByText(HEALTH_CONNECT_DISABLED_MESSAGE)).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(signals).toEqual([]);
  } finally {
    unsubscribe();
  }
});
