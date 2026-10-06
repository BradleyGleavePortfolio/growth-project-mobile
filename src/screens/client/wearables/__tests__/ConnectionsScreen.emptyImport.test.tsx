/**
 * B-HC4-118 (Opus B-362-1, Sol B-362-4): the REAL ConnectionsScreen hosting the REAL
 * ConnectProviderSheet, wired as in production (`onConnected={closeSheet}`). An empty first
 * import keeps the sheet open with where-to-check copy and Close, on iPhone and Android; an
 * import with data closes it. Adapted from the AUD-OPUS-H45-118 (run 37220060376) and
 * AUD-SOL-H45-118 (run 37219439582) probes.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
const mockInvalidate = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => ({ data: [], isLoading: false, isError: false, isRefetching: false }),
  useLocalOnDeviceAuthorization: () => ({ data: undefined }),
  useDisconnectProvider: () => ({ mutate: jest.fn(), isPending: false }),
  useStartOauth: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useInvalidateWearableConnections: () => mockInvalidate,
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../../../../config/healthConnect', () => ({
  HEALTH_CONNECT_DISABLED_MESSAGE: 'disabled',
  isHealthConnectProviderDisabled: () => false,
}));
jest.mock('../../../../services/health/onDeviceConnect', () => ({
  connectOnDeviceProvider: jest.fn(async () => 'granted'),
  openHealthConnectPermissions: jest.fn(async () => true),
  openHealthConnectStore: jest.fn(async () => true),
}));
jest.mock('../../../../services/authActions', () => ({ signOut: jest.fn() }));
jest.mock('../../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
let mockSource = 'APPLE_HEALTHKIT';
const mockConnectOnDevice = jest.fn();
jest.mock('../../../../services/health/onDeviceSync', () => ({
  ...jest.requireActual('../../../../services/health/onDeviceSync'),
  deviceSourceForPlatform: () => mockSource,
  deviceSourceFor: () => mockSource,
  beginOnDeviceConnect: async () => ({
    userId: 'user-a',
    assertCurrent: async () => undefined,
    throwIfStopped: () => undefined,
    cancel: () => undefined,
  }),
  connectOnDevice: (...args: unknown[]) => mockConnectOnDevice(...args),
}));

import ConnectionsScreen from '../ConnectionsScreen';
import { onDeviceDisclosure } from '../ConnectProviderSheet';

const EMPTY = /no data from the last 30 days to bring in/;
describe.each([
  ['APPLE_HEALTHKIT', 'Apple Health', /open the Health app, tap your profile picture/, null],
  ['HEALTH_CONNECT', 'Health Connect', /tap Open Health Connect, choose App/, 'Open Health Connect'],
] as const)('%s: first import in the production host', (source, name, where, cta) => {
  async function connect(postedCount: number) {
    mockSource = source;
    mockInvalidate.mockReset();
    mockConnectOnDevice.mockReset().mockResolvedValue({
      kind: 'imported', source, connectionId: 'conn-a', postedCount, complete: true,
    });
    await render(<ConnectionsScreen />);
    await fireEvent.press(screen.getByLabelText(`Connect ${name}`));
    await fireEvent.press(screen.getByLabelText(`Continue connecting ${name}`));
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalledTimes(1));
  }

  it('a complete import with data closes the sheet', async () => {
    await connect(5);
    await waitFor(() => expect(screen.queryByLabelText(`Continue connecting ${name}`)).toBeNull());
  });

  it('an empty first import stays open, says where to check, and offers Close', async () => {
    await connect(0);
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(where)).toBeTruthy();
    if (cta != null) expect(screen.getByLabelText(cta)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
  });
});

it('B-364-1: the Samsung Health permission note names Health Connect and every app', () => {
  const note = onDeviceDisclosure('Samsung Health', 'SAMSUNG_HEALTH');
  expect(note).toContain('Health Connect asks for permission');
  expect(note).toContain('every other app that shares with Health Connect');
  expect(note).not.toContain('Samsung Health asks');
});
