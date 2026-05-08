/**
 * Unit tests for the biometric lock service.
 *
 * Mocks:
 *   - expo-local-authentication: controls hasHardwareAsync / isEnrolledAsync /
 *     authenticateAsync return values.
 *   - ../storage/mmkv: stubs the MMKV secureStorage instance used to track
 *     fail counts and timeout prefs.
 *   - ../utils/authEvents: asserts logout is emitted on lockout.
 *   - ../services/secureStorage: stubs token deletion.
 */

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

// Shared in-memory store — lives at module scope so the mock factory,
// tests, and beforeEach all reference the same object.
// Note: because jest.mock() hoists to the top of the module, we can't use
// a `const` declared below it. We mutate via helpers exported from the mock.
jest.mock('../storage/mmkv', () => {
  const store: Record<string, string> = {};
  const mockStorage = {
    getString: (key: string): string | undefined => store[key],
    getStringAsync: async (key: string): Promise<string | undefined> => store[key],
    set: async (key: string, value: string | number | boolean): Promise<void> => {
      store[key] = String(value);
    },
    delete: async (key: string): Promise<void> => {
      delete store[key];
    },
    clearNamespace: async (): Promise<void> => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  };
  return {
    prefsStorage: mockStorage,
    cacheStorage: mockStorage,
    secureStorage: mockStorage,
    clearAllStorage: async (): Promise<void> => mockStorage.clearNamespace(),
  };
});

// authEvents is a plain object with on/off/emit — not a real EventEmitter.
// We replace it with a lightweight compatible stub.
jest.mock('../utils/authEvents', () => {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    authEvents: {
      on: (event: string, fn: () => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
      },
      off: (event: string, fn: () => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((l) => l !== fn);
        }
      },
      emit: (event?: string) => {
        if (event && listeners[event]) {
          listeners[event].forEach((fn) => fn());
        }
      },
      // Test helper to reset between tests.
      __reset: () => {
        Object.keys(listeners).forEach((k) => delete listeners[k]);
      },
    },
  };
});

jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

// expo-crypto mock: digestStringAsync returns a hex string (not ArrayBuffer).
jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(
    async (_alg: string, input: string): Promise<string> => `sha256:${input}`,
  ),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

import * as LocalAuthentication from 'expo-local-authentication';
import {
  requireAuth,
  setBiometricTimeout,
  getBiometricTimeout,
} from '../security/biometric-lock.service';
import { authEvents } from '../utils/authEvents';
import { secureStorage as mockSecureStorage } from '../storage/mmkv';

const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.MockedFunction<
  typeof LocalAuthentication.hasHardwareAsync
>;
const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.MockedFunction<
  typeof LocalAuthentication.isEnrolledAsync
>;
const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.MockedFunction<
  typeof LocalAuthentication.authenticateAsync
>;

// Narrow cast so we can call __reset without TS errors.
type TestAuthEvents = typeof authEvents & { __reset?: () => void };

beforeEach(async () => {
  await mockSecureStorage.clearNamespace();
  jest.clearAllMocks();
  (authEvents as TestAuthEvents).__reset?.();
});

// ─── requireAuth — biometric happy path ──────────────────────────────────────

describe('requireAuth', () => {
  it('returns success=true when biometric auth succeeds', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true } as never);

    const result = await requireAuth('Unlock');

    expect(result.success).toBe(true);
    expect(result.reason).toBe('biometric');
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Unlock' }),
    );
  });

  it('returns success=false when biometric auth is dismissed', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: 'user_cancel' } as never);

    const result = await requireAuth();

    expect(result.success).toBe(false);
    expect(result.reason).toBe('biometric');
  });

  it('falls through (success=true) when device has no biometric hardware', async () => {
    mockHasHardware.mockResolvedValue(false);

    const result = await requireAuth();

    expect(result.success).toBe(true);
    expect(result.reason).toBe('fallthrough');
  });

  it('returns reason=pin when no biometrics enrolled and PIN is set', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(false);

    // Simulate a PIN already stored in the MMKV encrypted slot.
    await mockSecureStorage.set('biometric_pin_hash', 'sha256:123456');

    const result = await requireAuth();

    expect(result.success).toBe(false);
    expect(result.reason).toBe('pin');
  });

  it('emits authEvents logout after 5 failed attempts', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: 'biometric_unknown' } as never);

    const logoutSpy = jest.fn();
    authEvents.on('logout', logoutSpy);

    // Trigger 5 failures.
    for (let i = 0; i < 5; i++) {
      await requireAuth();
    }

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    authEvents.off('logout', logoutSpy);
  });
});

// ─── Timeout preference ───────────────────────────────────────────────────────

describe('biometric timeout preference', () => {
  it('defaults to 5 minutes when not set', async () => {
    const timeout = await getBiometricTimeout();
    expect(timeout).toBe(5);
  });

  it('persists and reads back the chosen timeout', async () => {
    await setBiometricTimeout(15);
    const timeout = await getBiometricTimeout();
    expect(timeout).toBe(15);
  });

  it('handles "never" (0) as a valid timeout', async () => {
    await setBiometricTimeout(0);
    const timeout = await getBiometricTimeout();
    expect(timeout).toBe(0);
  });
});
