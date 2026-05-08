/**
 * Biometric unlock gate hook.
 *
 * Behaviour:
 *   - Reads the opt-in flag from SecureStore (key: `biometric_unlock_enabled`).
 *   - If opt-in is false → the gate returns 'unlocked' immediately. Users
 *     who haven't opted in must NEVER be locked out.
 *   - If opt-in is true and the device has enrolled biometrics →
 *     prompts via expo-local-authentication. Success unlocks; failure or
 *     dismissal keeps the gate in 'locked' state with a retry available.
 *   - If opt-in is true but the device has no enrolled biometrics →
 *     the gate falls through to 'unlocked' rather than locking the user
 *     out (we never want a hardware change to brick the app). The Settings
 *     toggle is auto-disabled in that case so it doesn't drift back.
 *
 * Cold-start vs background:
 *   The gate prompts on cold start AND when the app returns from background
 *   after more than BACKGROUND_TIMEOUT_MS (5 minutes). We track the last
 *   foregrounded timestamp in module-scoped state; tests reset it via the
 *   exported __resetForTests helper.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

export const BIOMETRIC_OPT_IN_KEY = 'biometric_unlock_enabled';
export const BACKGROUND_TIMEOUT_MS = 5 * 60 * 1000;

export type GateStatus = 'checking' | 'locked' | 'unlocked';

interface AuthResult {
  success: boolean;
}

let lastForegroundedAt: number | null = null;

export function __resetForTests() {
  lastForegroundedAt = null;
}

async function readOptIn(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(BIOMETRIC_OPT_IN_KEY);
    return v === 'true';
  } catch {
    return false;
  }
}

async function tryAuthenticate(): Promise<AuthResult> {
  // Web has no biometric concept — skip the gate entirely.
  if (Platform.OS === 'web') return { success: true };
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return { success: true };
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      // Opt-in is on but the user has no biometrics enrolled (e.g. they
      // turned Face ID off after opting in). Don't lock them out.
      return { success: true };
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock The Growth Project',
      // disableDeviceFallback=false → if biometrics fail, iOS/Android can
      // fall back to the device passcode, matching the spec.
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return { success: !!result.success };
  } catch {
    // If the module can't load (web, missing native), don't block the user.
    return { success: true };
  }
}

export interface UseBiometricGateResult {
  status: GateStatus;
  retry: () => void;
}

export function useBiometricGate(): UseBiometricGateResult {
  const [status, setStatus] = useState<GateStatus>('checking');
  const mountedRef = useRef(true);

  const evaluate = useCallback(async () => {
    setStatus('checking');
    const optedIn = await readOptIn();
    if (!optedIn) {
      lastForegroundedAt = Date.now();
      if (mountedRef.current) setStatus('unlocked');
      return;
    }
    const auth = await tryAuthenticate();
    if (!mountedRef.current) return;
    if (auth.success) {
      lastForegroundedAt = Date.now();
      setStatus('unlocked');
    } else {
      setStatus('locked');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    evaluate();
    return () => {
      mountedRef.current = false;
    };
  }, [evaluate]);

  // Re-prompt after returning from background past the timeout.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        const since = lastForegroundedAt ? Date.now() - lastForegroundedAt : Infinity;
        if (since > BACKGROUND_TIMEOUT_MS) {
          evaluate();
        }
      } else if (next === 'background' || next === 'inactive') {
        // Snapshot when the user backgrounded so the next foreground can
        // decide whether to re-prompt.
        lastForegroundedAt = Date.now();
      }
    });
    return () => sub.remove();
  }, [evaluate]);

  return { status, retry: evaluate };
}

// Helpers for the Settings toggle — kept here so the storage key has one owner.
export async function getBiometricOptIn(): Promise<boolean> {
  return readOptIn();
}

export async function setBiometricOptIn(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(BIOMETRIC_OPT_IN_KEY, enabled ? 'true' : 'false');
}

export async function isBiometricSupportedOnDevice(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}
