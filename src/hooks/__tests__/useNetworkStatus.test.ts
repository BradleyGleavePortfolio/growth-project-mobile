import { act, renderHook, waitFor } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import { useNetworkStatus, isEffectivelyOnline } from '../useNetworkStatus';

describe('useNetworkStatus', () => {
  beforeEach(() => {
    (NetInfo as any).__reset();
  });

  it('initial probe populates state from NetInfo.fetch', async () => {
    (NetInfo as any).__setState({ isConnected: true, isInternetReachable: true });
    const { result } = await renderHook(() => useNetworkStatus());

    await waitFor(() => {
      expect(result.current.isOnline).toBe(true);
      expect(result.current.isInternetReachable).toBe(true);
    });
  });

  it('updates when NetInfo emits a change', async () => {
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isOnline).toBe(true));

    await act(() => {
      (NetInfo as any).__setState({ isConnected: false, isInternetReachable: false });
    });

    await waitFor(() => {
      expect(result.current.isOnline).toBe(false);
      expect(result.current.isInternetReachable).toBe(false);
    });
    expect(isEffectivelyOnline(result.current)).toBe(false);
  });
});
