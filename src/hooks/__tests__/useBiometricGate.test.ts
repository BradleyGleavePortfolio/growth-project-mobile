import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import {
  useBiometricGate,
  __resetForTests,
  BIOMETRIC_OPT_IN_KEY,
  BIOMETRIC_CHECK_TIMEOUT_MS,
} from '../useBiometricGate';

// expo-local-authentication isn't shimmed by jest-expo for our setup, so we
// supply a programmable mock the tests can drive.
const mockHasHardware = jest.fn();
const mockIsEnrolled = jest.fn();
const mockAuthenticate = jest.fn();

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: (...args: unknown[]) => mockHasHardware(...args),
  isEnrolledAsync: (...args: unknown[]) => mockIsEnrolled(...args),
  authenticateAsync: (...args: unknown[]) => mockAuthenticate(...args),
}));

describe('useBiometricGate', () => {
  beforeEach(() => {
    (SecureStore as any).__store?.clear?.();
    __resetForTests();
    mockHasHardware.mockReset().mockResolvedValue(true);
    mockIsEnrolled.mockReset().mockResolvedValue(true);
    mockAuthenticate.mockReset().mockResolvedValue({ success: true });
  });

  it('opt-in false → bypasses biometric and returns unlocked', async () => {
    await SecureStore.setItemAsync(BIOMETRIC_OPT_IN_KEY, 'false');

    const { result } = await renderHook(() => useBiometricGate());

    await waitFor(() => expect(result.current.status).toBe('unlocked'));
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('opt-in true + biometrics succeed → unlocks', async () => {
    await SecureStore.setItemAsync(BIOMETRIC_OPT_IN_KEY, 'true');
    mockAuthenticate.mockResolvedValueOnce({ success: true });

    const { result } = await renderHook(() => useBiometricGate());

    await waitFor(() => expect(result.current.status).toBe('unlocked'));
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });

  it('opt-in true + biometrics fail → stays locked, retry available', async () => {
    await SecureStore.setItemAsync(BIOMETRIC_OPT_IN_KEY, 'true');
    mockAuthenticate.mockResolvedValueOnce({ success: false });

    const { result } = await renderHook(() => useBiometricGate());

    await waitFor(() => expect(result.current.status).toBe('locked'));

    // Retry that succeeds → unlocks.
    mockAuthenticate.mockResolvedValueOnce({ success: true });
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('unlocked'));
  });

  it('opt-in true but no hardware → unlocks (do not lock out users)', async () => {
    await SecureStore.setItemAsync(BIOMETRIC_OPT_IN_KEY, 'true');
    mockHasHardware.mockResolvedValueOnce(false);

    const { result } = await renderHook(() => useBiometricGate());

    await waitFor(() => expect(result.current.status).toBe('unlocked'));
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('opt-in true but biometrics not enrolled → unlocks (do not lock out users)', async () => {
    await SecureStore.setItemAsync(BIOMETRIC_OPT_IN_KEY, 'true');
    mockHasHardware.mockResolvedValueOnce(true);
    mockIsEnrolled.mockResolvedValueOnce(false);

    const { result } = await renderHook(() => useBiometricGate());

    await waitFor(() => expect(result.current.status).toBe('unlocked'));
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  // START-HANG-134 (B35, B36).
  it('opt-in read that never answers: unlocks after the time limit (never blocks)', async () => {
    jest.useFakeTimers();
    try {
      const spy = jest
        .spyOn(SecureStore, 'getItemAsync')
        .mockImplementationOnce(() => new Promise<string | null>(() => undefined));
      const { result } = await renderHook(() => useBiometricGate());
      expect(result.current.status).toBe('checking');
      await act(async () => {
        await jest.advanceTimersByTimeAsync(BIOMETRIC_CHECK_TIMEOUT_MS);
      });
      expect(result.current.status).toBe('unlocked');
      expect(mockAuthenticate).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('not opted in: checking again never leaves the unlocked state (the app is not unmounted)', async () => {
    await SecureStore.setItemAsync(BIOMETRIC_OPT_IN_KEY, 'false');
    const seen: string[] = [];
    const { result } = await renderHook(() => {
      const gate = useBiometricGate();
      seen.push(gate.status);
      return gate;
    });
    await waitFor(() => expect(result.current.status).toBe('unlocked'));
    seen.length = 0;
    await act(async () => {
      result.current.retry();
    });
    expect(seen).not.toContain('checking');
    expect(result.current.status).toBe('unlocked');
  });
});
