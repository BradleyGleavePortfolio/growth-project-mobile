/**
 * Biometric lock service for The Growth Project.
 *
 * This service is the canonical home for all biometric / PIN auth logic.
 * The existing `useBiometricGate` hook (which pre-existed this track) is NOT
 * replaced — it handles the cold-start gate already. This service adds:
 *
 *   1. `requireAuth()` — imperative call for sensitive in-app actions (e.g.
 *      viewing payment details). Returns a Promise<boolean>.
 *   2. User-configurable lock timeout (1 / 5 / 15 / never minutes).
 *   3. PIN fallback (6-digit) for devices without enrolled biometrics.
 *      PIN is stored as a SHA-256 hex hash in the MMKV encrypted slot.
 *   4. Lockout after 5 consecutive failed attempts: clears the session token
 *      and emits an `authEvents` logout event.
 *
 * The timeout setting persists in `secureStorage` under the key
 * `biometric_timeout_minutes`. The existing `useBiometricGate` reads the
 * opt-in flag from expo-secure-store (`biometric_unlock_enabled`). This
 * service reads the NEW timeout preference from MMKV so the two stores stay
 * consistent with their existing ownership.
 *
 * Wiring:
 *   - App.tsx already renders <BiometricUnlockGate> with the AppState
 *     background→foreground listener via `useBiometricGate`. The gate now
 *     reads the timeout preference via `getBiometricTimeout()` exported here.
 *   - The Settings screen exposes a timeout picker via the
 *     `BiometricTimeoutSetting` UI component (to be added in a follow-up if
 *     not already present).
 *
 * @see docs/offline-architecture.md — Biometric lock section
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { secureStorage } from '../storage/mmkv';
import { authEvents } from '../utils/authEvents';
import { secureStorage as nativeSecureStorage } from '../services/secureStorage';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Valid lock-timeout values in minutes. `0` means "never re-lock". */
export type LockTimeoutMinutes = 1 | 5 | 15 | 0;

export interface AuthResult {
  success: boolean;
  reason?: 'biometric' | 'pin' | 'fallthrough' | 'locked_out';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY_TIMEOUT = 'biometric_timeout_minutes';
const STORAGE_KEY_PIN_HASH = 'biometric_pin_hash';
const STORAGE_KEY_FAIL_COUNT = 'biometric_fail_count';
const MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_TIMEOUT: LockTimeoutMinutes = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** SHA-256 a string and return lowercase hex. Works on iOS, Android, and web. */
async function sha256(input: string): Promise<string> {
  const { digest } = await import('expo-crypto');
  const { CryptoDigestAlgorithm } = await import('expo-crypto');
  return digest(CryptoDigestAlgorithm.SHA256, input);
}

// ─── Timeout preference ──────────────────────────────────────────────────────

/**
 * Read the user's preferred lock timeout.
 * Falls back to DEFAULT_TIMEOUT when not yet set.
 */
export async function getBiometricTimeout(): Promise<LockTimeoutMinutes> {
  const raw = await secureStorage.getStringAsync(STORAGE_KEY_TIMEOUT);
  if (raw === null || raw === undefined) return DEFAULT_TIMEOUT;
  const n = parseInt(raw, 10);
  if ([0, 1, 5, 15].includes(n)) return n as LockTimeoutMinutes;
  return DEFAULT_TIMEOUT;
}

/**
 * Persist the user's lock-timeout preference.
 * Called from the Settings screen timeout picker.
 */
export async function setBiometricTimeout(minutes: LockTimeoutMinutes): Promise<void> {
  await secureStorage.set(STORAGE_KEY_TIMEOUT, minutes);
}

// ─── PIN management ──────────────────────────────────────────────────────────

/**
 * Store a 6-digit PIN as a SHA-256 hash in the encrypted MMKV slot.
 * Never store the plain PIN.
 */
export async function setPinHash(pin: string): Promise<void> {
  const hash = await sha256(pin);
  await secureStorage.set(STORAGE_KEY_PIN_HASH, hash);
}

/** Returns true if a PIN has been set. */
export async function hasPinSet(): Promise<boolean> {
  const v = await secureStorage.getStringAsync(STORAGE_KEY_PIN_HASH);
  return !!v;
}

/**
 * Verify a 6-digit PIN.
 * Manages the failed-attempts counter — on MAX_FAILED_ATTEMPTS, clears
 * the session and emits a logout event.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await secureStorage.getStringAsync(STORAGE_KEY_PIN_HASH);
  if (!stored) return false;

  const attempt = await sha256(pin);
  const match = attempt === stored;

  if (!match) {
    await incrementFailCount();
    return false;
  }

  // Successful attempt — reset counter.
  await secureStorage.set(STORAGE_KEY_FAIL_COUNT, '0');
  return true;
}

async function incrementFailCount(): Promise<void> {
  const raw = await secureStorage.getStringAsync(STORAGE_KEY_FAIL_COUNT);
  const current = parseInt(raw ?? '0', 10);
  const next = current + 1;
  await secureStorage.set(STORAGE_KEY_FAIL_COUNT, String(next));

  if (next >= MAX_FAILED_ATTEMPTS) {
    await onLockout();
  }
}

/** Read the current failed-attempts count. */
export async function getFailedAttemptCount(): Promise<number> {
  const raw = await secureStorage.getStringAsync(STORAGE_KEY_FAIL_COUNT);
  return parseInt(raw ?? '0', 10);
}

// ─── Lockout ─────────────────────────────────────────────────────────────────

/**
 * Called when the failed-attempt threshold is reached.
 * Clears the session tokens and emits the logout event.
 * The navigation stack will collapse to the login screen via the existing
 * authEvents listener in RootNavigator.
 */
async function onLockout(): Promise<void> {
  try {
    // Clear access tokens from native secure storage so the session is invalid.
    await nativeSecureStorage.deleteItem('supabase_token');
    await nativeSecureStorage.deleteItem('supabase_refresh_token');
  } catch {
    // Non-fatal — proceed with the logout event even if delete fails.
  }
  // Reset fail counter to allow fresh login.
  await secureStorage.set(STORAGE_KEY_FAIL_COUNT, '0');
  authEvents.emit('logout');
}

// ─── Main requireAuth ─────────────────────────────────────────────────────────

/**
 * Prompt the user for biometric or PIN authentication.
 *
 *   - On web: always resolves true (no hardware).
 *   - If device has enrolled biometrics: shows Face ID / Touch ID prompt.
 *   - If biometrics unavailable but PIN is set: resolves with the string
 *     'needs_pin'; the caller is responsible for showing a PIN entry UI.
 *     (In the current foundation this is documented as a follow-up — see PR
 *     body. The service returns { success: false, reason: 'needs_pin' } so
 *     callers can branch.)
 *   - After 5 failures: clears session + emits logout.
 *
 * @param promptMessage - String shown in the OS biometric dialog.
 */
export async function requireAuth(
  promptMessage = 'Confirm your identity',
): Promise<AuthResult> {
  if (Platform.OS === 'web') {
    return { success: true, reason: 'fallthrough' };
  }

  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hasHardware
      ? await LocalAuthentication.isEnrolledAsync()
      : false;

    if (enrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });

      if (!result.success) {
        const count = await incrementBiometricFailSafe();
        if (count >= MAX_FAILED_ATTEMPTS) {
          return { success: false, reason: 'locked_out' };
        }
        return { success: false, reason: 'biometric' };
      }

      // Success — reset counter.
      await secureStorage.set(STORAGE_KEY_FAIL_COUNT, '0');
      return { success: true, reason: 'biometric' };
    }

    // No enrolled biometrics — check for PIN fallback.
    if (await hasPinSet()) {
      return { success: false, reason: 'pin' };
    }

    // Neither biometrics nor PIN configured — fall through.
    return { success: true, reason: 'fallthrough' };
  } catch {
    // If the module throws (e.g. first-install on a low-end device), fail open
    // rather than locking the user out.
    return { success: true, reason: 'fallthrough' };
  }
}

/** Biometric-specific fail counter (shared with PIN counter for simplicity). */
async function incrementBiometricFailSafe(): Promise<number> {
  const raw = await secureStorage.getStringAsync(STORAGE_KEY_FAIL_COUNT);
  const current = parseInt(raw ?? '0', 10);
  const next = current + 1;
  await secureStorage.set(STORAGE_KEY_FAIL_COUNT, String(next));
  if (next >= MAX_FAILED_ATTEMPTS) {
    await onLockout();
  }
  return next;
}
