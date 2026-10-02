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

// S14: the on-device grant now registers the source and imports history.
const mockImportHistory = jest.fn();
const mockResume = jest.fn();
const mockFence = { userId: 'user-a', assertCurrent: jest.fn(async () => undefined), cancel: jest.fn() };
const mockBegin = jest.fn(async () => mockFence);
jest.mock('../../../../services/health/onDeviceSync', () => {
  const actual = jest.requireActual('../../../../services/health/onDeviceSync');
  return {
    OnDeviceNotSignedInError: actual.OnDeviceNotSignedInError,
    OnDeviceStepError: actual.OnDeviceStepError,
    deviceSourceFor: (p: string) =>
      p === 'APPLE_HEALTHKIT' ? 'APPLE_HEALTHKIT' : p === 'GARMIN' ? null : 'HEALTH_CONNECT',
    beginOnDeviceConnect: () => mockBegin(),
    connectOnDevice: (...args: unknown[]) => mockImportHistory(...args),
    resumeOnDeviceImport: (...args: unknown[]) => mockResume(...args),
  };
});

import ConnectProviderSheet, { onDeviceDisclosure } from '../ConnectProviderSheet';
import { subscribeTutorialSignals } from '../../../../tutorial/tutorialEvents';
import type { TutorialSignal } from '../../../../tutorial/types';

// Clinic tutorial: the wearable step completes on the sheet's real grant.
const tutorialSignals: TutorialSignal[] = [];
let unsubscribeTutorial: () => void = () => undefined;
beforeEach(() => {
  tutorialSignals.length = 0;
  unsubscribeTutorial = subscribeTutorialSignals((s) => tutorialSignals.push(s));
});
afterEach(() => unsubscribeTutorial());

beforeEach(() => {
  mockStartOauthMutateAsync.mockReset();
  mockInvalidate.mockReset();
  mockOpenAuthSessionAsync.mockReset();
  mockConnectOnDevice.mockReset();
  mockImportHistory.mockReset();
  mockResume.mockReset();
  mockBegin.mockClear();
  mockFence.cancel.mockClear();
  mockImportHistory.mockResolvedValue({
    kind: 'imported',
    source: 'APPLE_HEALTHKIT',
    connectionId: 'conn-a',
    postedCount: 3,
    complete: true,
  });
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
        screen.getByText(
          "We couldn't start the connection. Check your internet connection, then tap Continue.",
        ),
      ).toBeTruthy(),
    );
  });
});

describe('ConnectProviderSheet — S14 history import', () => {
  it('keeps the sheet open with plain copy when the import lane is off', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    mockImportHistory.mockResolvedValue({
      kind: 'disabled',
      source: 'APPLE_HEALTHKIT',
    });
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));

    await waitFor(() =>
      expect(screen.getByText(/Health data import isn't switched on yet/)).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(tutorialSignals).toEqual([]);
  });

  it('shows a specific message with a reference when the import fails unexpectedly', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    const { OnDeviceStepError } = jest.requireActual('../../../../services/health/onDeviceSync');
    mockImportHistory.mockRejectedValue(new OnDeviceStepError('import', new Error('boom')));
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));

    await waitFor(() =>
      expect(screen.getByText(/history didn't finish coming in because of a problem on our side/)).toBeTruthy(),
    );
    expect(screen.getByText(/hello@thegrowthproject.app/)).toBeTruthy();
    expect(mockInvalidate).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says nothing was connected when registration cannot reach the server', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    const { OnDeviceStepError } = jest.requireActual('../../../../services/health/onDeviceSync');
    const netErr = Object.assign(new Error('Network Error'), { isAxiosError: true, config: {} });
    mockImportHistory.mockRejectedValue(new OnDeviceStepError('register', netErr));
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));

    await waitFor(() =>
      expect(screen.getByText(/We couldn't reach The Growth Project to connect Apple Health/)).toBeTruthy(),
    );
    expect(screen.getByText('Continue')).toBeTruthy();
  });

  // Sol B-317-2: an incomplete import is never presented as complete.
  it('B-317-2: a partial import keeps the sheet open with Continue import, and resume finishes it', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    mockImportHistory.mockResolvedValue({
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'conn-a',
      postedCount: 10,
      complete: false,
    });
    mockResume.mockResolvedValue({
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'conn-a',
      postedCount: 4,
      complete: true,
    });
    const onClose = jest.fn();
    const onConnected = jest.fn();
    await render(
      <ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} onConnected={onConnected} />,
    );

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() => expect(screen.getByText(/We brought in part of your last 30 days/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Continue import for Apple Health'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockResume).toHaveBeenCalledWith('APPLE_HEALTHKIT', 'conn-a', mockFence);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('B-317-2: every read failing shows Try again, not success', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    mockImportHistory.mockResolvedValue({
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'conn-a',
      postedCount: 0,
      complete: false,
    });
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() => expect(screen.getByText(/we couldn't read your history yet/)).toBeTruthy());
    expect(screen.getByLabelText('Try again for Apple Health')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('B-317-2: a resume that is still incomplete (pass bound reached) stays truthful', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    const partial = {
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'conn-a',
      postedCount: 5,
      complete: false,
    };
    mockImportHistory.mockResolvedValue(partial);
    mockResume.mockResolvedValue(partial);
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() => expect(screen.getByLabelText('Continue import for Apple Health')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Continue import for Apple Health'));
    await waitFor(() => expect(mockResume).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/We brought in part of your last 30 days/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('A-317-1: the run is bound before the native prompt and cancelled when the sheet closes', async () => {
    let resolvePrompt: (v: string) => void = () => undefined;
    mockConnectOnDevice.mockImplementation(
      () => new Promise<string>((r) => { resolvePrompt = r; }),
    );
    const view = await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={jest.fn()} />);
    // Not awaited: the press handler stays pending on the open prompt.
    const pressed = fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() => expect(mockConnectOnDevice).toHaveBeenCalled());
    // The fence was taken before the prompt opened.
    expect(mockBegin).toHaveBeenCalledTimes(1);
    expect(mockBegin.mock.invocationCallOrder[0]).toBeLessThan(
      mockConnectOnDevice.mock.invocationCallOrder[0],
    );
    await view.rerender(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible={false} onClose={jest.fn()} />);
    expect(mockFence.cancel).toHaveBeenCalled();
    resolvePrompt('granted');
    await pressed;
    expect(mockImportHistory).not.toHaveBeenCalled();
  });

  it('imports Samsung Health through the Health Connect source', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="SAMSUNG_HEALTH" visible onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText(/Continue connecting Samsung Health/));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockImportHistory).toHaveBeenCalledWith('HEALTH_CONNECT', mockFence);
  });
});

describe('ConnectProviderSheet — on-device provider', () => {
  it('C-317-2: discloses the 30-day import and coaching use before Continue', async () => {
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={jest.fn()} />);
    const text = screen.getByText(/last 30 days of Apple Health data/);
    expect(text).toBeTruthy();
    expect(screen.getByText(/new data each time you open Health/)).toBeTruthy();
    expect(screen.getByText(/your coach can personalize your training, recovery, and check-ins/)).toBeTruthy();
    // Shown before any permission request or import starts.
    expect(mockConnectOnDevice).not.toHaveBeenCalled();
    expect(mockImportHistory).not.toHaveBeenCalled();
  });

  it('C-317-2: the disclosure copy is plain (no exclamation marks)', () => {
    const copy = onDeviceDisclosure('Health Connect');
    expect(copy).not.toMatch(/!/);
    expect(copy).toContain('last 30 days of Health Connect data');
  });

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

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockConnectOnDevice).toHaveBeenCalledWith('APPLE_HEALTHKIT');
    // S14: the grant runs the 30-day history import before closing.
    expect(mockImportHistory).toHaveBeenCalledWith('APPLE_HEALTHKIT', mockFence);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Never routed through the cloud OAuth path.
    expect(mockStartOauthMutateAsync).not.toHaveBeenCalled();
    // The real grant is the tutorial's "wearable connected" signal.
    expect(tutorialSignals).toEqual(['wearable_connected']);
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
    // A denial is never counted as connected.
    expect(tutorialSignals).toEqual([]);
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
