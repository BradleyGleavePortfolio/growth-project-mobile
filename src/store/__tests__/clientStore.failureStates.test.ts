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

  it('clears the previous day immediately when a different date is selected', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    useClientStore.getState().setSelectedDate('2026-10-05');
    expect(useClientStore.getState()).toMatchObject({
      selectedDate: '2026-10-05', foodLogs: [], waterOz: 0, hasLoadedDay: false,
      dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, loadError: null,
    });
    mockGetFood.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().loadDayData('client');
    expect(useClientStore.getState()).toMatchObject({
      selectedDate: '2026-10-05', foodLogs: [], waterOz: 0,
      hasLoadedDay: false, isLoading: false, loadError: expect.any(String),
      dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
  });

  it('retains a loaded day when its date is selected again', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    useClientStore.getState().setSelectedDate('2026-10-06');
    expect(useClientStore.getState()).toMatchObject({
      hasLoadedDay: true, waterOz: 20, dailyTotals: { calories: 420 },
    });
  });

  it('keeps the Home day when an earlier Food Log day finishes loading later', async () => {
    const previousFood = {
      data: {
        ...foodDay.data,
        total_calories: 900,
        entries: [{
          id: 'previous-meal', user_id: 'client', food_item_id: 'oats',
          meal_type: 'breakfast', quantity_multiplier: 1,
          food_item: { id: 'oats', name: 'Oats', calories: 900, protein_g: 30, carbs_g: 50, fat_g: 11 },
        }],
      },
    };
    let resolvePrevious!: (response: typeof previousFood) => void;
    mockGetFood.mockReturnValueOnce(new Promise<typeof previousFood>((resolve) => {
      resolvePrevious = resolve;
    }));
    mockGetWater.mockResolvedValueOnce({
      data: {
        total_ml: 1182.94,
        logs: [{ id: 'previous-water', amount_ml: 1182.94, logged_at: '2026-10-05T12:00:00Z' }],
      },
    });
    const previousLoad = useClientStore.getState().loadDayData('client', '2026-10-05');

    await useClientStore.getState().loadDayData('client', '2026-10-06');
    const homeDay = useClientStore.getState();
    expect(homeDay).toMatchObject({
      selectedDate: '2026-10-06', foodLogs: [], dailyTotals: { calories: 420 },
      waterOz: 20, waterEntries: [], hasLoadedDay: true, isLoading: false, loadError: null,
    });

    resolvePrevious(previousFood);
    await previousLoad;
    expect(useClientStore.getState()).toEqual(homeDay);
  });

  it('ignores an earlier day failure while the selected Home day is still loading', async () => {
    let rejectPrevious!: (error: Error) => void;
    let resolveHome!: (response: typeof foodDay) => void;
    mockGetFood
      .mockReturnValueOnce(new Promise<never>((_resolve, reject) => {
        rejectPrevious = reject;
      }))
      .mockReturnValueOnce(new Promise<typeof foodDay>((resolve) => {
        resolveHome = resolve;
      }));
    const previousLoad = useClientStore.getState().loadDayData('client', '2026-10-05');
    const homeLoad = useClientStore.getState().loadDayData('client', '2026-10-06');
    const homeLoading = useClientStore.getState();

    rejectPrevious(new Error('Network Error'));
    await previousLoad;
    expect(useClientStore.getState()).toEqual(homeLoading);
    expect(useClientStore.getState()).toMatchObject({
      selectedDate: '2026-10-06', hasLoadedDay: false, isLoading: true, loadError: null,
    });

    resolveHome(foodDay);
    await homeLoad;
    expect(useClientStore.getState()).toMatchObject({
      selectedDate: '2026-10-06', hasLoadedDay: true, isLoading: false, loadError: null,
    });
  });

  it('clears stale water before a new day whose water read fails', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    mockGetWater.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().loadDayData('client', '2026-10-05');
    expect(useClientStore.getState()).toMatchObject({
      selectedDate: '2026-10-05', hasLoadedDay: true, waterOz: 0,
      loadError: 'Water data could not refresh. Check your connection and try again.',
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

  it('rounds the failed metric water-add notice without changing the saved amount or rollback', async () => {
    await useClientStore.getState().loadDayData('client', '2026-10-06');
    mockLogWater.mockRejectedValueOnce(new Error('Network Error'));
    await useClientStore.getState().logWater('client', '', 250 / 29.5735);
    expect(mockLogWater).toHaveBeenCalledWith({ amount_ml: 250, date: '2026-10-06' });
    expect(useClientStore.getState().waterOz).toBeCloseTo(20);
    expect(useClientStore.getState().loadError)
      .toBe('8 oz of water was not saved. Check the connection, then add it again.');
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
