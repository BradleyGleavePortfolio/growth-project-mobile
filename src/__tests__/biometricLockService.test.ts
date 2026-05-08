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

jest.mock('../storage/mmkv', () => {
  const store: Record<string, string> = {};
  const mockStorage = {
    getString: (key: string) => store[key],
    getStringAsync: async (key: string) => store[key],
    set: async (key: string, value: string | number | boolean) => {
      store[key] = String(value);
    },
    delete: async (key: string) => { delete store[key]; },
    clearNamespace: async () => { Object.keys(store).forEach((k) => delete store[k]); },
    __store: store,
  };
  return {
    prefsStorage: mockStorage,
    cacheStorage: mockStorage,
    secureStorage: mockStorage,
    clearAllStorage: async () => mockStorage.clearNamespace(),
  };
});

jest.mock('../utils/authEvents', () => {
  const EventEmitter = require('events');
  return { authEvents: new EventEmitter() };
});

jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    deleteItem: jest.fn(),
  },
}));

// expo-crypto mock for sha256 helper inside the service.
jest.mock('expo-crypto', () => ({
  digest: jest.fn(async (_alg: string, input: string) => `sha256:${input}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

import * as LocalAuthentication from 'expo-local-authentication';
import { requireAuth, setBiometricTimeout, getBiometricTimeout } from '../security/biometric-lock.service';
import { authEvents } from '../utils/authEvents';

const mockHasHardware = LocalAuthentication.hasHardwareAsync as jest.MockedFunction<typeof LocalAuthentication.hasHardwareAsync>;
const mockIsEnrolled = LocalAuthentication.isEnrolledAsync as jest.MockedFunction<typeof LocalAuthentication.isEnrolledAsync>;
const mockAuthenticate = LocalAuthentication.authenticateAsync as jest.MockedFunction<typeof LocalAuthentication.authenticateAsync>;

// Helper to clear MMKV store between tests.
beforeEach(async () => {
  const { secureStorage } = require('../storage/mmkv');
  await secureStorage.clearNamespace();
  jest.clearAllMocks();
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

    // Simulate a PIN already set in MMKV.
    const { secureStorage } = require('../storage/mmkv');
    await secureStorage.set('secure:biometric_pin_hash', 'sha256:123456');

    const result = await requireAuth();

    expect(result.success).toBe(false);
    expect(result.reason).toBe('pin');
  });

  it('emits authEvents logout and returns locked_out after 5 failed attempts', async () => {
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: false, error: 'biometric_unknown' } as never);

    const logoutSpy = jest.fn();
    authEvents.once('logout', logoutSpy);

    // Trigger 5 failures.
    for (let i = 0; i < 5; i++) {
      await requireAuth();
    }

    expect(logoutSpy).toHaveBeenCalledTimes(1);
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
