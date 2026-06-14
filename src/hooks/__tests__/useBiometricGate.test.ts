import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import {
  useBiometricGate,
  __resetForTests,
  BIOMETRIC_OPT_IN_KEY,
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
});
