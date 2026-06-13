/**
 * ConnectProviderSheet — connect-flow tests.
 *
 * Verifies the two fully-implemented connect paths:
 *   • cloud OAuth (Oura) — Continue starts OAuth and opens the auth session,
 *     then invalidates the connections cache and closes on a returning session,
 *   • on-device (Apple Health) — Continue drives the native permission request
 *     and, on grant, invalidates + closes; on a non-grant outcome it renders a
 *     polished, user-visible error and keeps the sheet open.
 *
 * The hooks, the auth-session browser, and the on-device native seam are mocked
 * so the test isolates the sheet's own branching + state rendering.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const mockStartOauthMutateAsync = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useStartOauth: () => ({
    mutateAsync: mockStartOauthMutateAsync,
    isPending: false,
  }),
  useInvalidateWearableConnections: () => mockInvalidate,
}));

const mockOpenAuthSessionAsync = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}));

const mockConnectOnDevice = jest.fn();
jest.mock('../../../../services/health/onDeviceConnect', () => ({
  connectOnDeviceProvider: (...args: unknown[]) => mockConnectOnDevice(...args),
}));

import ConnectProviderSheet from '../ConnectProviderSheet';

beforeEach(() => {
  mockStartOauthMutateAsync.mockReset();
  mockInvalidate.mockReset();
  mockOpenAuthSessionAsync.mockReset();
  mockConnectOnDevice.mockReset();
});

describe('ConnectProviderSheet — cloud OAuth provider', () => {
  it('starts OAuth, opens the auth session, invalidates, and closes', async () => {
    mockStartOauthMutateAsync.mockResolvedValue({
      authorizationUrl: 'https://provider.example/oauth',
      state: 'csrf-1',
    });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: 'success' });
    const onClose = jest.fn();
    const onConnected = jest.fn();

    await render(
      <ConnectProviderSheet
        provider="OURA"
        visible
        onClose={onClose}
        onConnected={onConnected}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Continue connecting Oura'));

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
    expect(mockStartOauthMutateAsync).toHaveBeenCalledWith('OURA');
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith(
      'https://provider.example/oauth',
      'tgp://wearables/connected',
    );
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Never routed through the on-device seam.
    expect(mockConnectOnDevice).not.toHaveBeenCalled();
  });

  it('shows a user-visible error when starting OAuth fails', async () => {
    mockStartOauthMutateAsync.mockRejectedValue(new Error('network'));
    await render(<ConnectProviderSheet provider="OURA" visible onClose={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText('Continue connecting Oura'));

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't start the connection. Please try again."),
      ).toBeTruthy(),
    );
  });
});

describe('ConnectProviderSheet — on-device provider', () => {
  it('drives the native permission request and closes on grant', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    const onClose = jest.fn();
    const onConnected = jest.fn();

    await render(
      <ConnectProviderSheet
        provider="APPLE_HEALTHKIT"
        visible
        onClose={onClose}
        onConnected={onConnected}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));

    await waitFor(() => expect(mockConnectOnDevice).toHaveBeenCalledWith('APPLE_HEALTHKIT'));
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Never routed through the cloud OAuth path.
    expect(mockStartOauthMutateAsync).not.toHaveBeenCalled();
  });

  it('renders a polished error and stays open when access is denied', async () => {
    mockConnectOnDevice.mockResolvedValue('denied');
    const onClose = jest.fn();

    await render(
      <ConnectProviderSheet
        provider="APPLE_HEALTHKIT"
        visible
        onClose={onClose}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));

    await waitFor(() =>
      expect(screen.getByText(/access wasn't granted/i)).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('explains next steps when the device store is not set up', async () => {
    mockConnectOnDevice.mockResolvedValue('unavailable');
    await render(
      <ConnectProviderSheet
        provider="HEALTH_CONNECT"
        visible
        onClose={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));

    await waitFor(() =>
      expect(screen.getByText(/isn't set up on this device yet/i)).toBeTruthy(),
    );
  });

  it('states clearly when the provider is unsupported on this device', async () => {
    mockConnectOnDevice.mockResolvedValue('unsupported');
    await render(
      <ConnectProviderSheet
        provider="HEALTH_CONNECT"
        visible
        onClose={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));

    await waitFor(() =>
      expect(
        screen.getByText("Health Connect can't be connected on this device."),
      ).toBeTruthy(),
    );
  });
});
