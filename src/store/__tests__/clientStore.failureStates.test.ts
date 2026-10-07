import { useClientStore } from '../clientStore';

const mockGetFood = jest.fn();
const mockGetWater = jest.fn();
const mockLogWater = jest.fn();

jest.mock('../../services/api', () => ({
  logApi: { getDaily: (...args: unknown[]) => mockGetFood(...args) },
  waterApi: {
    getDaily: (...args: unknown[]) => mockGetWater(...args),
    log: (...args: unknown[]) => mockLogWater(...args),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));

const foodDay = {
  data: {
    entries: [],
    total_calories: 420, total_protein_g: 30, total_carbs_g: 50, total_fat_g: 11,
  },
};

describe('client day data failure state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useClientStore.getState().reset();
    mockGetFood.mockResolvedValue(foodDay);
    mockGetWater.mockResolvedValue({ data: { total_ml: 591.47 } });
  });

  it('distinguishes a failed read from an empty food log and stops loading', async () => {
    mockGetFood.mockRejectedValue(new Error('Network Error'));
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    expect(useClientStore.getState()).toMatchObject({
      isLoading: false,
      loadError: 'Food and water data could not refresh. Check your connection and try again.',
    });
  });

  it('keeps previously displayed data on failure and clears the notice after a successful retry', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    mockGetFood.mockRejectedValueOnce(new Error('Request failed with status code 503'));
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    expect(useClientStore.getState().dailyTotals.calories).toBe(420);
    expect(useClientStore.getState()).toMatchObject({ loadError: expect.any(String) });
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    expect(useClientStore.getState()).toMatchObject({ isLoading: false, loadError: null });
  });

  it('does not turn a water-read failure into an unlabelled zero', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    mockGetWater.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    expect(useClientStore.getState()).toMatchObject({
      waterOz: 20, isLoading: false,
      loadError: 'Water data could not refresh. Check your connection and try again.',
    });
    expect(useClientStore.getState().dailyTotals.calories).toBe(420);
  });

  it('removes a failed-read notice when resetting the store', async () => {
    mockGetFood.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().loadDayData('client');
    useClientStore.getState().reset();
    expect(useClientStore.getState()).toMatchObject({ loadError: null, isLoading: false });
  });

  it('says so when added water was not saved, instead of silently taking it back', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    mockLogWater.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().logWater('client', '', 8);
    expect(useClientStore.getState()).toMatchObject({
      waterOz: 20,
      loadError: '8 oz of water was not saved. Check the connection, then add it again.',
    });
  });

  it('clears the failed water-add notice when the next water add succeeds', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    mockLogWater.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().logWater('client', '', 8);
    expect(useClientStore.getState().loadError).toContain('was not saved');
    mockLogWater.mockResolvedValueOnce({ data: {} });
    await useClientStore.getState().logWater('client', '', 8);
    expect(useClientStore.getState()).toMatchObject({ waterOz: 28, loadError: null });
  });

  it('does not clear an unrelated day-read failure after a successful water add', async () => {
    mockGetFood.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    const notice = useClientStore.getState().loadError;
    mockLogWater.mockResolvedValueOnce({ data: {} });
    await useClientStore.getState().logWater('client', '', 8);
    expect(useClientStore.getState().loadError).toBe(notice);
  });
});
