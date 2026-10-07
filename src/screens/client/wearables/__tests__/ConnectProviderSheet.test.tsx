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
const mockOpenHcPermissions = jest.fn(async () => true);
const mockOpenHcStore = jest.fn(async () => true);
jest.mock('../../../../services/health/onDeviceConnect', () => ({
  connectOnDeviceProvider: (...args: unknown[]) => mockConnectOnDevice(...args),
  openHealthConnectPermissions: () => mockOpenHcPermissions(),
  openHealthConnectStore: () => mockOpenHcStore(),
}));

const mockSignOut = jest.fn(async () => undefined);
jest.mock('../../../../services/authActions', () => ({
  signOut: () => mockSignOut(),
}));

const mockReport = jest.fn();
jest.mock('../../../../lib/consultation/report', () => ({
  reportUnexpected: (...args: unknown[]) => mockReport(...args),
}));

// S14: the on-device grant now registers the source and imports history.
const mockImportHistory = jest.fn();
const mockResume = jest.fn();
const mockFence = {
  userId: 'user-a',
  assertCurrent: jest.fn(async () => undefined),
  throwIfStopped: jest.fn(),
  cancel: jest.fn(),
};
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
  mockFence.throwIfStopped.mockReset();
  mockOpenHcPermissions.mockClear();
  mockOpenHcStore.mockClear();
  mockSignOut.mockClear();
  mockReport.mockClear();
  mockImportHistory.mockResolvedValue({
    kind: 'imported',
    source: 'APPLE_HEALTHKIT',
    connectionId: 'conn-a',
    postedCount: 3,
    complete: true,
  });
});

describe('ConnectProviderSheet — cloud OAuth provider', () => {
  // B-WEARLIST-125: the server callback reports a failed connect in the return
  // URL; the sheet stays open with a retry instead of closing as connected.
  it('keeps the sheet open with a retry when the return URL says status=error', async () => {
    mockStartOauthMutateAsync.mockResolvedValue({
      authorizationUrl: 'https://provider.example/oauth',
      state: 'csrf-1',
    });
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'tgp://wearables/connected?status=error',
    });
    const onClose = jest.fn();
    const onConnected = jest.fn();

    await render(
      <ConnectProviderSheet provider="OURA" visible onClose={onClose} onConnected={onConnected} />,
    );
    await fireEvent.press(screen.getByLabelText('Continue connecting Oura'));

    await waitFor(() =>
      expect(screen.getByText(/The sign-in with Oura did not finish\. Tap Continue to try again\./)).toBeTruthy(),
    );
    expect(mockInvalidate).toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

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

});

/**
 * Sol B-317-8: a failed cloud connect reads the HTTP status and machine code.
 * Before the fix every failure (401, 500, ...) said "check your internet".
 */
function httpError(status: number | null, data: Record<string, unknown> = {}, requestId?: string) {
  return Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    config: { headers: requestId ? { 'x-request-id': requestId } : {} },
    response: status === null ? undefined : { status, data, headers: {} },
  });
}

describe('ConnectProviderSheet — cloud connect failures (Sol B-317-8)', () => {
  async function pressOura() {
    await render(<ConnectProviderSheet provider="OURA" visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Oura'));
  }

  it('a real network failure gives internet advice and Continue', async () => {
    mockStartOauthMutateAsync.mockRejectedValue(httpError(null));
    await pressOura();
    await waitFor(() =>
      expect(
        screen.getByText(
          "The Growth Project couldn't be reached, so Oura isn't connected yet. Check your internet connection, then tap Continue.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByLabelText('Continue connecting Oura')).toBeTruthy();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('401 says the session ended and Log in again signs out', async () => {
    mockStartOauthMutateAsync.mockRejectedValue(httpError(401));
    await pressOura();
    await waitFor(() => expect(screen.getByText(/Your session has ended, so Oura isn't connected/)).toBeTruthy());
    expect(screen.queryByText(/internet/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Log in again'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('403 says client accounts only, with no retry button', async () => {
    mockStartOauthMutateAsync.mockRejectedValue(httpError(403));
    await pressOura();
    await waitFor(() => expect(screen.getByText(/client account only/)).toBeTruthy());
    expect(screen.queryByLabelText('Continue connecting Oura')).toBeNull();
  });

  it('429 asks to wait a minute', async () => {
    mockStartOauthMutateAsync.mockRejectedValue(httpError(429));
    await pressOura();
    await waitFor(() => expect(screen.getByText(/Too many tries in a short time/)).toBeTruthy());
  });

  it('503 wearables_cloud_disabled says it is not switched on yet', async () => {
    mockStartOauthMutateAsync.mockRejectedValue(httpError(503, { code: 'wearables_cloud_disabled' }));
    await pressOura();
    await waitFor(() => expect(screen.getByText(/Connecting Oura is not available in this version/)).toBeTruthy());
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('500 shows a reference and the support address and reports to Sentry', async () => {
    mockStartOauthMutateAsync.mockRejectedValue(httpError(500, {}, 'abcd1234-ffff'));
    await pressOura();
    await waitFor(() => expect(screen.getByText(/Reference abcd1234/)).toBeTruthy());
    expect(screen.getByText(/Bradleyapple1031@gmail.com/)).toBeTruthy();
    expect(screen.queryByText(/internet/)).toBeNull();
    expect(mockReport).toHaveBeenCalledWith(
      'wearables.cloud_connect',
      expect.objectContaining({ status: 500, requestId: 'abcd1234-ffff' }),
    );
  });

  it('a sign-in window that fails to open shows a reference', async () => {
    mockStartOauthMutateAsync.mockResolvedValue({ authorizationUrl: 'https://x.example', state: 's' });
    mockOpenAuthSessionAsync.mockRejectedValue(new Error('no browser'));
    await pressOura();
    await waitFor(() => expect(screen.getByText(/sign-in window didn't open/)).toBeTruthy());
    expect(mockReport).toHaveBeenCalledWith('wearables.cloud_connect_browser', expect.anything());
  });

  it('a locked auth session says another sign-in window is open', async () => {
    mockStartOauthMutateAsync.mockResolvedValue({ authorizationUrl: 'https://x.example', state: 's' });
    mockOpenAuthSessionAsync.mockResolvedValue({ type: 'locked' });
    await pressOura();
    await waitFor(() => expect(screen.getByText(/Another sign-in window is already open/)).toBeTruthy());
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
      expect(screen.getByText(/Health data import is not available in this version/)).toBeTruthy(),
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
      expect(screen.getByText(/history didn't finish coming in because of an unexpected problem/)).toBeTruthy(),
    );
    expect(screen.getByText(/Bradleyapple1031@gmail.com/)).toBeTruthy();
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
      expect(screen.getByText(/couldn't be reached, so Apple Health isn't connected yet/)).toBeTruthy(),
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
    await waitFor(() => expect(screen.getByText(/part of your last 30 days is in/)).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText(/your history couldn't be read yet/)).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText(/part of your last 30 days is in/)).toBeTruthy());
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
    expect(mockConnectOnDevice).toHaveBeenCalledWith('APPLE_HEALTHKIT', expect.any(Function));
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

  it('Apple Health: a refusal stays open with Continue and is never counted as connected', async () => {
    mockConnectOnDevice.mockResolvedValue('denied');
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() => expect(screen.getByText(/Apple Health access wasn't allowed, so nothing was read/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(tutorialSignals).toEqual([]);
  });

  it('Health Connect: a refusal offers Open Health Connect, then Continue', async () => {
    mockConnectOnDevice.mockResolvedValue('denied');
    await render(<ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));
    await waitFor(() => expect(screen.getByText(/choose App permissions, then The Growth Project/)).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Open Health Connect'));
    expect(mockOpenHcPermissions).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByText('When Health Connect access is set up, tap Continue to connect.')).toBeTruthy(),
    );
    expect(screen.getByLabelText('Continue connecting Health Connect')).toBeTruthy();
    // Nothing was prompted again or imported by opening settings.
    expect(mockConnectOnDevice).toHaveBeenCalledTimes(1);
    expect(mockImportHistory).not.toHaveBeenCalled();
  });

  it('Health Connect not installed: Get Health Connect opens the Play Store (nothing opens on its own)', async () => {
    mockConnectOnDevice.mockResolvedValue('unavailable');
    await render(<ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));
    await waitFor(() => expect(screen.getByText(/Health Connect isn't installed on this phone/)).toBeTruthy());
    expect(mockOpenHcStore).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Get Health Connect'));
    expect(mockOpenHcStore).toHaveBeenCalledTimes(1);
  });

  it('Health Connect needs an update: Update Health Connect; a store that does not open says where to go', async () => {
    mockConnectOnDevice.mockResolvedValue('update_required');
    mockOpenHcStore.mockResolvedValueOnce(false);
    await render(<ConnectProviderSheet provider="SAMSUNG_HEALTH" visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText(/Continue connecting Samsung Health/));
    await waitFor(() => expect(screen.getByText(/Samsung Health shares its data through Health Connect/)).toBeTruthy());
    expect(screen.getByText(/Health Connect needs an update/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Update Health Connect'));
    await waitFor(() => expect(screen.getByText(/The Play Store didn't open/)).toBeTruthy());
  });

  it('a permission screen that fails to open shows Continue with a reference and reports it', async () => {
    mockConnectOnDevice.mockResolvedValue('error');
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() => expect(screen.getByText(/permission screen didn't open, so nothing was read/)).toBeTruthy());
    expect(screen.getByText(/mention reference [A-Za-z0-9-]{8}/)).toBeTruthy();
    expect(mockReport).toHaveBeenCalledWith(
      'wearables.on_device_permission',
      expect.objectContaining({ code: 'native_permission_error' }),
    );
    expect(screen.getByLabelText('Continue connecting Apple Health')).toBeTruthy();
  });

  it('states clearly when the provider is unsupported on this device', async () => {
    mockConnectOnDevice.mockResolvedValue('unsupported');
    await render(<ConnectProviderSheet provider="HEALTH_CONNECT" visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Health Connect'));
    await waitFor(() =>
      expect(
        screen.getByText('Health Connect works on Android phones only. On this iPhone, connect Apple Health instead.'),
      ).toBeTruthy(),
    );
    expect(screen.queryByLabelText('Continue connecting Health Connect')).toBeNull();
  });

  it('a connect that found nothing to bring in says so and where to check, instead of closing', async () => {
    mockConnectOnDevice.mockResolvedValue('granted');
    mockImportHistory.mockResolvedValue({
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'conn-a',
      postedCount: 0,
      complete: true,
    });
    const onClose = jest.fn();
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() =>
      expect(screen.getByText(/no data from the last 30 days to bring in/)).toBeTruthy(),
    );
    expect(screen.getByText(/open the Health app, tap your profile picture/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Close')).toBeTruthy();
    expect(tutorialSignals).toEqual(['wearable_connected']);
  });

  it('a sign-out that began before the prompt opens stops the run: no prompt', async () => {
    mockFence.throwIfStopped.mockImplementation(() => {
      const { OnDeviceSessionChangedError } = jest.requireActual('../../../../services/health/sessionFence');
      throw new OnDeviceSessionChangedError();
    });
    await render(<ConnectProviderSheet provider="APPLE_HEALTHKIT" visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Continue connecting Apple Health'));
    await waitFor(() => expect(screen.getByText(/nothing was brought in/)).toBeTruthy());
    expect(mockConnectOnDevice).not.toHaveBeenCalled();
    expect(mockImportHistory).not.toHaveBeenCalled();
  });

  it('the disclosure says nothing is read or shared until the person allows it', () => {
    expect(onDeviceDisclosure('Apple Health')).toContain('Nothing is read or shared until you allow it.');
    expect(onDeviceDisclosure('Apple Health')).not.toMatch(/\bwe\b/i);
  });
});
