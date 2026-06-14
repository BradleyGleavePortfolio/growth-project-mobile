/**
 * HapticService unit tests — Phase 11 / Track 3
 *
 * Verifies that:
 *   1. Each method delegates to the correct expo-haptics call.
 *   2. All methods become no-ops when HAPTICS_ENABLED is false.
 *   3. refreshEnabled() re-reads AsyncStorage.
 *   4. setHapticsEnabled() synchronously overrides the flag.
 */

// async-storage v3's bundled jest mock is a real in-memory impl, not jest.fn()
// spies. This file expects spy methods (mockImplementation / mockResolvedValue),
// so we override the global mock with a file-local jest.fn() shape that matches
// the pattern used by the other PR #200 owned tests (queryClient.*.test.ts).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(),
    removeMany: jest.fn(),
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Mock expo-haptics before any module import ───────────────────────────────
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

// Import once — use setHapticsEnabled / refreshEnabled to manage state
import {
  HapticService,
  setHapticsEnabled,
  refreshEnabled,
} from '../haptics.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  beforeEach(async () => {
    jest.clearAllMocks();
    setStoredHaptics(true);
    setHapticsEnabled(true);
  });

  it('selection() calls selectionAsync', async () => {
    await HapticService.selection();
    expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
  });

  it('softImpact() calls impactAsync with Light', async () => {
    await HapticService.softImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Light');
  });

  it('mediumImpact() calls impactAsync with Medium', async () => {
    await HapticService.mediumImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Medium');
  });

  it('heavyImpact() calls impactAsync with Heavy', async () => {
    await HapticService.heavyImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Heavy');
  });

  it('success() calls notificationAsync with Success', async () => {
    await HapticService.success();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Success');
  });

  it('warning() calls notificationAsync with Warning', async () => {
    await HapticService.warning();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Warning');
  });

  it('error() calls notificationAsync with Error', async () => {
    await HapticService.error();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Error');
  });
});

describe('HapticService — disabled via setHapticsEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHapticsEnabled(false);
  });

  afterEach(() => {
    // Restore default enabled state for subsequent suites
    setHapticsEnabled(true);
  });

  it('all methods are no-ops when disabled', async () => {
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
  });

  afterEach(() => {
    setHapticsEnabled(true);
  });

  it('setHapticsEnabled(false) immediately silences all haptics', async () => {
    setHapticsEnabled(true);
    setHapticsEnabled(false);

    await HapticService.mediumImpact();
    await HapticService.success();
    expect(mockImpactAsync).not.toHaveBeenCalled();
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });

  it('setHapticsEnabled(true) re-enables haptics after disable', async () => {
    setHapticsEnabled(false);
    setHapticsEnabled(true);

    await HapticService.mediumImpact();
    expect(mockImpactAsync).toHaveBeenCalledWith('Medium');
  });
});

describe('HapticService — refreshEnabled', () => {
  afterEach(() => {
    setHapticsEnabled(true);
  });

  it('refreshEnabled() reads from AsyncStorage with key gp_client_settings', async () => {
    setStoredHaptics(true);
    await refreshEnabled();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('gp_client_settings');
  });

  it('refreshEnabled() disables haptics when stored value is false', async () => {
    jest.clearAllMocks();
    setStoredHaptics(false);
    await refreshEnabled();

    await HapticService.selection();
    expect(mockSelectionAsync).not.toHaveBeenCalled();

    // Restore
    setHapticsEnabled(true);
  });

  it('defaults to enabled when AsyncStorage returns null', async () => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await refreshEnabled();

    await HapticService.selection();
    expect(mockSelectionAsync).toHaveBeenCalledTimes(1);
  });
});
