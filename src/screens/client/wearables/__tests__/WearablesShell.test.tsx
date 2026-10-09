/**
 * WearablesShell — shell switcher + recovery-surface tests.
 *
 * Verifies:
 *   • the Fitness bucket mounts <HealthFitnessScreen/> (mocked),
 *   • switching to Recovery mounts <SleepRecoveryScreen/> (mocked) — the screen
 *     owns its own connect/empty/error states, so the shell no longer renders a
 *     placeholder surface,
 *   • the freshness chip renders from the connections hook.
 *
 * Both bucket screens, the connections hook, and navigation are mocked so the
 * test isolates the shell's own switching + routing logic.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: object }) =>
      ReactLocal.createElement(View, { style }, children),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    // REDO-DEVICES-133: the shared Screen reads insets from this context.
    SafeAreaInsetsContext: ReactLocal.createContext(null),
  };
});

// The bucket screens render their `aiPanelSlot` so the test can assert the
// HK-5b AI panel is mounted into each bucket (the shell pipes a
// <ClientWearableInsightPanel/> into that slot).
jest.mock('../HealthFitnessScreen', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ aiPanelSlot }: { aiPanelSlot?: React.ReactNode }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(Text, null, 'FITNESS_OVERVIEW'),
        aiPanelSlot,
      ),
  };
});

jest.mock('../SleepRecoveryScreen', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ aiPanelSlot }: { aiPanelSlot?: React.ReactNode }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(Text, null, 'RECOVERY_OVERVIEW'),
        aiPanelSlot,
      ),
  };
});

// Stub the AI panel to a bucket-tagged marker so we can assert which bucket it
// was mounted for without exercising the real React Query hook here.
jest.mock('../ClientWearableInsightPanel', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ bucket }: { bucket: string }) =>
      ReactLocal.createElement(Text, null, `AI_PANEL_${bucket}`),
  };
});

const mockUseWearableConnections = jest.fn();
const mockInvalidateWearables = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => mockUseWearableConnections(),
  useInvalidateWearableConnections: () => mockInvalidateWearables,
}));

// S14: the AI panel is behind a default-off flag (D2 consent); the getter
// lets each test choose the value without re-importing the shell.
let mockAiInsightsFlag = true;
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: {
    get wearableAiInsights() {
      return mockAiInsightsFlag;
    },
  },
}));

// S14: refresh-on-open runs the on-device import seam.
const mockImportHistory = jest.fn();
let mockDeviceSource: string | null = 'APPLE_HEALTHKIT';
jest.mock('../../../../services/health/onDeviceSync', () => {
  const actual = jest.requireActual('../../../../services/health/onDeviceSync');
  return {
    OnDeviceNotSignedInError: actual.OnDeviceNotSignedInError,
    OnDeviceStepError: actual.OnDeviceStepError,
    deviceSourceForPlatform: () => mockDeviceSource,
    refreshOnDevice: (...args: unknown[]) => mockImportHistory(...args),
  };
});

const mockSignOut = jest.fn(async () => undefined);
jest.mock('../../../../services/authActions', () => ({
  signOut: () => mockSignOut(),
}));
const mockOpenHcPermissions = jest.fn(async () => true);
jest.mock('../../../../services/health/onDeviceConnect', () => ({
  openHealthConnectPermissions: () => mockOpenHcPermissions(),
  openHealthConnectStore: jest.fn(async () => true),
}));

const mockReportUnexpected = jest.fn();
jest.mock('../../../../lib/consultation/report', () => ({
  reportUnexpected: (...args: unknown[]) => mockReportUnexpected(...args),
}));

jest.mock('../../../../utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Reduce-motion ON ⇒ the shell takes its documented instant-swap path, so the
// bucket switch is synchronous and the test asserts on the settled UI without
// coupling to the 200ms cross-fade animation timing.
jest.mock('../components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
let mockRouteParams: { bucket?: 'fitness' | 'recovery' } = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
  useRoute: () => ({ params: mockRouteParams }),
}));

import WearablesShell from '../WearablesShell';
import { stopOnDeviceHealthWork } from '../../../../services/health/sessionFence';
import { logger } from '../../../../utils/logger';

beforeEach(() => {
  mockAiInsightsFlag = true;
  mockDeviceSource = 'APPLE_HEALTHKIT';
  mockImportHistory.mockReset();
  mockImportHistory.mockResolvedValue({
    kind: 'imported',
    source: 'APPLE_HEALTHKIT',
    connectionId: 'c1',
    postedCount: 0,
    complete: true,
  });
  mockReportUnexpected.mockReset();
  mockInvalidateWearables.mockReset();
  mockNavigate.mockReset();
  mockSetParams.mockReset();
  mockRouteParams = {};
  mockUseWearableConnections.mockReturnValue({
    data: [
      {
        id: 'c1',
        user_id: 'u1',
        provider: 'APPLE_HEALTHKIT',
        external_account_id: null,
        access_token_expires_at: null,
        scopes: [],
        webhook_subscription_id: null,
        channel_expires_at: null,
        status: 'connected',
        last_error: null,
        // Synced just now so the chip reads `current` (post R1 P1 #3, a sync
        // older than 6h would read as the new `stale` tier).
        last_synced_at: new Date().toISOString(),
        backfilled_until: null,
        disconnected_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  });
});

describe('WearablesShell', () => {
  it('mounts the Fitness overview by default and renders the freshness chip', async () => {
    await render(<WearablesShell />);
    expect(screen.getByText('FITNESS_OVERVIEW')).toBeTruthy();
    expect(screen.getByText('All sources current')).toBeTruthy();
  });

  // REDO-DEVICES-133: the shell opens on the same words as the More row, and
  // the sync notice is a hairline band, not a cream box.
  it('opens on the Health and sleep title stack', async () => {
    await render(<WearablesShell />);
    expect(screen.getByRole('header', { name: 'Health and sleep' })).toBeTruthy();
    expect(screen.getByText('Health data')).toBeTruthy();
  });

  it('switches to Recovery → mounts the Sleep & Recovery screen, never a placeholder gate', async () => {
    await render(<WearablesShell />);
    await fireEvent.press(screen.getByLabelText('Recovery'));
    expect(screen.getByText('RECOVERY_OVERVIEW')).toBeTruthy();
    expect(screen.queryByText('FITNESS_OVERVIEW')).toBeNull();
    // syncs the route param so deep-links restore the last bucket
    expect(mockSetParams).toHaveBeenCalledWith({ bucket: 'recovery' });
  });

  it('mounts the Sleep & Recovery screen directly when deep-linked to recovery', async () => {
    mockRouteParams = { bucket: 'recovery' };
    await render(<WearablesShell />);
    expect(screen.getByText('RECOVERY_OVERVIEW')).toBeTruthy();
  });

  it('mounts the client AI insight panel into each bucket', async () => {
    await render(<WearablesShell />);
    // Fitness bucket → the H&F-scoped panel is mounted.
    expect(screen.getByText('AI_PANEL_HEALTH_FITNESS')).toBeTruthy();

    // Switch to Recovery → the S&R-scoped panel is mounted.
    await fireEvent.press(screen.getByLabelText('Recovery'));
    expect(screen.getByText('AI_PANEL_SLEEP_RECOVERY')).toBeTruthy();
    expect(screen.queryByText('AI_PANEL_HEALTH_FITNESS')).toBeNull();
  });

  it('S14: does not mount the AI panel while wearableAiInsights is off', async () => {
    mockAiInsightsFlag = false;
    await render(<WearablesShell />);
    expect(screen.getByText('FITNESS_OVERVIEW')).toBeTruthy();
    expect(screen.queryByText('AI_PANEL_HEALTH_FITNESS')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Recovery'));
    expect(screen.queryByText('AI_PANEL_SLEEP_RECOVERY')).toBeNull();
  });

  it("S14: refreshes this phone's connected health store once on open", async () => {
    await render(<WearablesShell />);
    await waitFor(() => expect(mockInvalidateWearables).toHaveBeenCalledTimes(1));
    expect(mockImportHistory).toHaveBeenCalledTimes(1);
    // A-317-1: the refresh is handed the server rows so it can require the
    // SAME connection this person connected through on this phone.
    expect(mockImportHistory).toHaveBeenCalledWith('APPLE_HEALTHKIT', expect.any(Array));
  });

  it('S14 A-317-1: does not refetch when this phone was never connected by this person', async () => {
    mockImportHistory.mockResolvedValue({ kind: 'not_authorized', source: 'APPLE_HEALTHKIT' });
    await render(<WearablesShell />);
    await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(1));
    expect(mockInvalidateWearables).not.toHaveBeenCalled();
  });

  it('S14: does not refresh when this phone has no connected health store', async () => {
    mockDeviceSource = 'HEALTH_CONNECT';
    await render(<WearablesShell />);
    expect(screen.getByText('FITNESS_OVERVIEW')).toBeTruthy();
    expect(mockImportHistory).not.toHaveBeenCalled();
  });

  // Opus B-317-5: connected on the server but not synced by this phone (after
  // a sign-out, reinstall or second phone) is said out loud, with Reconnect.
  it('B-317-5: says the phone is not syncing and routes Reconnect to Connections', async () => {
    mockImportHistory.mockResolvedValue({ kind: 'not_authorized', source: 'APPLE_HEALTHKIT' });
    await render(<WearablesShell />);
    await waitFor(() =>
      expect(
        screen.getByText('Apple Health is not syncing on this phone. Tap Reconnect to continue.'),
      ).toBeTruthy(),
    );
    // REDO-DEVICES-133: a hairline band on the page, no cream fill.
    const band = StyleSheet.flatten(screen.getByTestId('health-notice').props.style);
    expect(band.backgroundColor).toBeUndefined();
    expect(band.borderTopWidth).toBe(StyleSheet.hairlineWidth);
    await fireEvent.press(screen.getByLabelText('Reconnect Apple Health'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  // Sol B-317-2: an incomplete refresh is never discarded silently.
  it('B-317-2: an incomplete refresh shows what happened and Try again re-runs it', async () => {
    mockImportHistory.mockResolvedValueOnce({
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'c1',
      postedCount: 3,
      complete: false,
    });
    await render(<WearablesShell />);
    await waitFor(() =>
      expect(screen.getByText(/Some of your Apple Health data didn't come in this time/)).toBeTruthy(),
    );
    await fireEvent.press(screen.getByLabelText('Try again to sync Apple Health'));
    await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText(/Some of your Apple Health data didn't come in this time/)).toBeNull(),
    );
  });

  it('an unexpected refresh failure shows a reference and support path, and is reported', async () => {
    mockImportHistory.mockRejectedValue(new Error('boom'));
    await render(<WearablesShell />);
    await waitFor(() => expect(screen.getByText(/Bradleyapple1031@gmail.com/)).toBeTruthy());
    expect(mockReportUnexpected).toHaveBeenCalled();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  // S-WEAR-3: the notice button does what its copy says.
  it('a session that ended during refresh offers Log in again, which signs out', async () => {
    const { OnDeviceStepError } = jest.requireActual('../../../../services/health/onDeviceSync');
    const expired = Object.assign(new Error('401'), {
      isAxiosError: true,
      config: { headers: {} },
      response: { status: 401, data: {}, headers: {} },
    });
    mockImportHistory.mockRejectedValue(new OnDeviceStepError('import', expired));
    mockSignOut.mockClear();
    await render(<WearablesShell />);
    await waitFor(() => expect(screen.getByText(/your session ended before your history came in/)).toBeTruthy());
    expect(screen.queryByLabelText('Try again to sync Apple Health')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Log in again'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockImportHistory).toHaveBeenCalledTimes(1);
  });

  it('a connection no longer linked to the account offers Reconnect (Connections), not a refresh retry', async () => {
    const { OnDeviceStepError } = jest.requireActual('../../../../services/health/onDeviceSync');
    const forbidden = Object.assign(new Error('403'), {
      isAxiosError: true,
      config: { headers: {} },
      response: { status: 403, data: { code: 'wearables_connection_forbidden' }, headers: {} },
    });
    mockImportHistory.mockRejectedValue(new OnDeviceStepError('import', forbidden));
    mockNavigate.mockClear();
    await render(<WearablesShell />);
    await waitFor(() => expect(screen.getByText(/no longer linked to your account/)).toBeTruthy());
    // C-362-2: the copy names the button this screen shows.
    expect(screen.getByText(/Tap Reconnect to connect Apple Health again\./)).toBeTruthy();
    expect(screen.queryByText(/Tap Continue/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Reconnect Apple Health'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  // Opus B-362-2 (probe run 37220188407): after Open Health Connect the
  // notice names a step that exists here, and Try again re-runs the refresh.
  describe('B-362-2: every Health Connect permission off', () => {
    beforeEach(async () => {
      mockDeviceSource = 'HEALTH_CONNECT';
      const [row] = mockUseWearableConnections().data;
      mockUseWearableConnections.mockReturnValue({ data: [{ ...row, provider: 'HEALTH_CONNECT' }] });
      const { HealthConnectPermissionDeniedError } = jest.requireActual(
        '../../../../services/health/healthConnect/errors',
      );
      mockImportHistory.mockRejectedValue(new HealthConnectPermissionDeniedError(['Steps']));
      mockOpenHcPermissions.mockReset();
    });

    it('after Open Health Connect, Try again exists and re-runs the refresh', async () => {
      mockOpenHcPermissions.mockResolvedValue(true);
      await render(<WearablesShell />);
      await fireEvent.press(await screen.findByLabelText('Open Health Connect'));
      expect(
        await screen.findByText(
          'When Health Connect access is allowed for The Growth Project, tap Try again to bring in new data.',
        ),
      ).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Try again to sync Health Connect'));
      await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(2));
    });

    it('when Health Connect does not open, the notice says so and offers Try again', async () => {
      mockOpenHcPermissions.mockResolvedValue(false);
      await render(<WearablesShell />);
      await fireEvent.press(await screen.findByLabelText('Open Health Connect'));
      expect(await screen.findByText(/^Health Connect didn't open\. Open Settings/)).toBeTruthy();
      expect(screen.getByLabelText('Try again to sync Health Connect')).toBeTruthy();
    });
  });

  describe('C-317-a: a refresh that settles late writes nothing', () => {
    function heldRefresh() {
      const held: { resolve: (v: unknown) => void; reject: (e: unknown) => void } = {
        resolve: () => undefined,
        reject: () => undefined,
      };
      mockImportHistory.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            held.resolve = resolve;
            held.reject = reject;
          }),
      );
      return held;
    }
    const PARTIAL = { kind: 'imported', source: 'APPLE_HEALTHKIT', connectionId: 'c1', postedCount: 3, complete: false };

    it.each(['resolves partial', 'rejects'] as const)(
      'sign-out while the refresh runs, then it %s: no notice, no refetch, no report',
      async (how) => {
        jest.mocked(logger.warn).mockClear();
        const held = heldRefresh();
        await render(<WearablesShell />);
        await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(1));
        // signOut() calls this first, synchronously, before its first await.
        stopOnDeviceHealthWork();
        if (how === 'rejects') held.reject(new Error('boom'));
        else held.resolve(PARTIAL);
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByText(/didn't come in this time/)).toBeNull();
        expect(screen.queryByText(/Reference /)).toBeNull();
        expect(mockInvalidateWearables).not.toHaveBeenCalled();
        expect(mockReportUnexpected).not.toHaveBeenCalled();
        // C-317-b r2: a stale failure is not logged either.
        expect(jest.mocked(logger.warn)).not.toHaveBeenCalledWith('[wearables] on-device refresh failed', expect.anything());
      },
    );

    it('unmount while the refresh runs, then it finishes: no refetch', async () => {
      const held = heldRefresh();
      const view = await render(<WearablesShell />);
      await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(1));
      await view.unmount();
      held.resolve({ ...PARTIAL, complete: true });
      await new Promise((r) => setTimeout(r, 0));
      expect(mockInvalidateWearables).not.toHaveBeenCalled();
    });

    it('control: the same refresh with no session change refetches and shows the notice', async () => {
      const held = heldRefresh();
      await render(<WearablesShell />);
      await waitFor(() => expect(mockImportHistory).toHaveBeenCalledTimes(1));
      held.resolve(PARTIAL);
      await waitFor(() => expect(screen.getByText(/didn't come in this time/)).toBeTruthy());
      expect(mockInvalidateWearables).toHaveBeenCalledTimes(1);
    });
  });

  it('C-317-b: a refresh failure is logged by a closed class only, never its text', async () => {
    const warn = jest.mocked(logger.warn);
    warn.mockClear();
    mockImportHistory.mockRejectedValue(new Error('synthetic private text Janet'));
    await render(<WearablesShell />);
    await waitFor(() => expect(mockReportUnexpected).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith('[wearables] on-device refresh failed', { error: 'error' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Janet');
  });

  // C-317-b r2: `Error.name` is mutable, so a native or library error can
  // carry arbitrary text there. The log uses a closed set of classes only.
  it('C-317-b: an arbitrary Error.name never reaches the log', async () => {
    const warn = jest.mocked(logger.warn);
    warn.mockClear();
    const err = new Error('synthetic');
    err.name = 'Janet Doe heart rate 182';
    mockImportHistory.mockRejectedValue(err);
    await render(<WearablesShell />);
    await waitFor(() => expect(mockReportUnexpected).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][1] as { error: string };
    expect(['error', 'type', 'network', 'http', 'aborted', 'other']).toContain(logged.error);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Janet');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('182');
  });

  it('C-317-b: a non-Error rejection is logged as other, never its value', async () => {
    const warn = jest.mocked(logger.warn);
    warn.mockClear();
    mockImportHistory.mockRejectedValue('Janet Doe');
    await render(<WearablesShell />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith('[wearables] on-device refresh failed', { error: 'other' });
  });
});
