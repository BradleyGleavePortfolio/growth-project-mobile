/**
 * HapticService unit tests — Phase 11 / Track 3
 *
 * Verifies that:
 *   1. Each method delegates to the correct expo-haptics call.
 *   2. All methods become no-ops when HAPTICS_ENABLED is false.
 *   3. refreshEnabled() re-reads AsyncStorage.
 *   4. setHapticsEnabled() synchronously overrides the flag.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Mock expo-haptics ────────────────────────────────────────────────────────
const mockSelectionAsync = jest.fn().mockResolvedValue(undefined);
const mockImpactAsync = jest.fn().mockResolvedValue(undefined);
const mockNotificationAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-haptics', () => ({
  selectionAsync: (...args: unknown[]) => mockSelectionAsync(...args),
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
    Heavy: 'Heavy',
  },
  NotificationFeedbackType: {
    Success: 'Success',
    Warning: 'Warning',
    Error: 'Error',
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadService() {
  // Re-import so module-level bootstrap re-runs after AsyncStorage is set up
  jest.resetModules();
  const mod = await import('../haptics.service');
  return mod;
}

function setStoredHaptics(enabled: boolean) {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
    if (key === 'gp_client_settings') {
      return JSON.stringify({ hapticsEnabled: enabled });
    }
    return null;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HapticService — enabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setStoredHaptics(true);
  });

  it('selection() calls selectionAsync', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.selection();
    expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
  });

  it('softImpact() calls impactAsync with Light', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.softImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Light');
  });

  it('mediumImpact() calls impactAsync with Medium', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.mediumImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Medium');
  });

  it('heavyImpact() calls impactAsync with Heavy', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.heavyImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Heavy');
  });

  it('success() calls notificationAsync with Success', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.success();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Success');
  });

  it('warning() calls notificationAsync with Warning', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.warning();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Warning');
  });

  it('error() calls notificationAsync with Error', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.error();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Error');
  });
});

describe('HapticService — disabled via AsyncStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setStoredHaptics(false);
  });

  it('all methods are no-ops when hapticsEnabled=false in storage', async () => {
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();

    await HapticService.selection();
    await HapticService.softImpact();
    await HapticService.mediumImpact();
    await HapticService.heavyImpact();
    await HapticService.success();
    await HapticService.warning();
    await HapticService.error();

    expect(mockSelectionAsync).not.toHaveBeenCalled();
    expect(mockImpactAsync).not.toHaveBeenCalled();
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('HapticService — setHapticsEnabled override', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setStoredHaptics(true);
  });

  it('setHapticsEnabled(false) immediately silences all haptics', async () => {
    const { HapticService, setHapticsEnabled, refreshEnabled } = await loadService();
    await refreshEnabled(); // start enabled

    setHapticsEnabled(false);

    await HapticService.mediumImpact();
    await HapticService.success();
    expect(mockImpactAsync).not.toHaveBeenCalled();
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });

  it('setHapticsEnabled(true) re-enables haptics', async () => {
    const { HapticService, setHapticsEnabled, refreshEnabled } = await loadService();
    await refreshEnabled();
    setHapticsEnabled(false);
    setHapticsEnabled(true);

    await HapticService.mediumImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Medium');
  });
});

describe('HapticService — refreshEnabled', () => {
  it('refreshEnabled() reads from AsyncStorage with key gp_client_settings', async () => {
    setStoredHaptics(true);
    const { refreshEnabled } = await loadService();
    await refreshEnabled();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('gp_client_settings');
  });

  it('defaults to enabled when AsyncStorage returns null', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const { HapticService, refreshEnabled } = await loadService();
    await refreshEnabled();
    await HapticService.selection();
    expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
  });
});
