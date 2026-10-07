/**
 * FU-FOODLOG-126: a food saved offline reaches the log and shows in the day
 * once it is sent, without a manual refresh.
 */
const mockFlush = jest.fn();
const mockQueueLength = jest.fn();
jest.mock('../foodLogQueue', () => ({
  flush: () => mockFlush(),
  getQueueLength: () => mockQueueLength(),
}));
const mockLoadDayData = jest.fn(async () => undefined);
jest.mock('../../store/clientStore', () => ({
  useClientStore: { getState: () => ({ selectedDate: '2026-10-06', loadDayData: mockLoadDayData }) },
}));
let mockUser: { id: string } | null = { id: 'client-1' };
jest.mock('../../lib/userCache', () => ({ readUserCacheSync: () => mockUser }));

import { subscribePendingFoodLogs, syncFoodLogQueue } from '../foodLogSync';

beforeEach(() => {
  mockFlush.mockReset();
  mockQueueLength.mockReset();
  mockQueueLength.mockResolvedValue(0);
  mockLoadDayData.mockClear();
  mockUser = { id: 'client-1' };
});

describe('syncFoodLogQueue', () => {
  it('reloads the selected day after a food saved offline is sent', async () => {
    mockFlush.mockResolvedValue({ flushed: 1, remaining: 0, dropped: 0 });
    await expect(syncFoodLogQueue()).resolves.toBe(1);
    expect(mockLoadDayData).toHaveBeenCalledWith('client-1', '2026-10-06');
  });

  it('does not reload when nothing was waiting', async () => {
    mockFlush.mockResolvedValue({ flushed: 0, remaining: 0, dropped: 0 });
    await expect(syncFoodLogQueue()).resolves.toBe(0);
    expect(mockLoadDayData).not.toHaveBeenCalled();
  });

  it('does not reload when no one is signed in', async () => {
    mockUser = null;
    mockFlush.mockResolvedValue({ flushed: 1, remaining: 0, dropped: 0 });
    await syncFoodLogQueue();
    expect(mockLoadDayData).not.toHaveBeenCalled();
  });

  it('shares one send between overlapping triggers (foreground and reconnect together)', async () => {
    let finish: (v: { flushed: number; remaining: number; dropped: number }) => void = () => undefined;
    mockFlush.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const a = syncFoodLogQueue();
    const b = syncFoodLogQueue();
    finish({ flushed: 2, remaining: 0, dropped: 0 });
    await expect(Promise.all([a, b])).resolves.toEqual([2, 2]);
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('never rejects when sending fails, and keeps the waiting count current', async () => {
    mockFlush.mockRejectedValue(new Error('Network Error'));
    mockQueueLength.mockResolvedValue(2);
    const seen: number[] = [];
    const unsubscribe = subscribePendingFoodLogs((n) => seen.push(n));
    await expect(syncFoodLogQueue()).resolves.toBe(0);
    unsubscribe();
    expect(seen).toEqual([2]);
    expect(mockLoadDayData).not.toHaveBeenCalled();
  });
});
