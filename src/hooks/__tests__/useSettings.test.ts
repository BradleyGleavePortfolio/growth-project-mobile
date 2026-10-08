import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, waitFor } from '@testing-library/react-native';
import { clearUserCache, setUserCache } from '../../lib/userCache';
import { useSettings } from '../useSettings';

const mockGetProfile = jest.fn();
jest.mock('../../services/api', () => ({
  profileApi: { get: (...args: unknown[]) => mockGetProfile(...args) },
}));

// The profile seed runs at most once per app session, so these run in order:
// signed out, then a goal already on the phone, then the seed itself.
describe('useSettings', () => {
  beforeEach(async () => {
    mockGetProfile.mockReset();
    await AsyncStorage.clear();
    await clearUserCache();
  });

  it('defaults Fasting Alerts to on and reads no profile while signed out', async () => {
    const { result } = await renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.settings.fastingAlerts).toBe(true);
    expect(result.current.settings.waterGoalOz).toBe(100);
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it('keeps a water goal already saved on this phone', async () => {
    await setUserCache({ id: 'client-1', email: 'client@example.test' });
    await AsyncStorage.setItem('gp_client_settings', JSON.stringify({ waterGoalOz: 64 }));
    const { result } = await renderHook(() => useSettings());
    await waitFor(() => expect(result.current.settings.waterGoalOz).toBe(64));
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it("takes the profile's water goal when this phone has none, with one read for every open hook", async () => {
    await setUserCache({ id: 'client-1', email: 'client@example.test' });
    mockGetProfile.mockResolvedValue({ data: { water_goal_oz: 80.4 } });
    const first = await renderHook(() => useSettings());
    const second = await renderHook(() => useSettings());
    await waitFor(() => expect(first.result.current.settings.waterGoalOz).toBe(80));
    expect(second.result.current.settings.waterGoalOz).toBe(80);
    expect(mockGetProfile).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem('gp_client_settings'))!)).toMatchObject({ waterGoalOz: 80, fastingAlerts: true });
  });
});
