/**
 * FU-FOODLOG-126: foods saved offline are sent at cold start, on reconnect and
 * on return to the foreground; before this, only an in-app offline -> online
 * change (or pull to refresh) sent them, so a meal logged offline in an app
 * that was then closed never reached the log or the coach.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

const mockSync = jest.fn(async () => 0);
const mockReadPending = jest.fn(async () => 0);
const mockListeners = new Set<(n: number) => void>();
jest.mock('../../services/foodLogSync', () => ({
  syncFoodLogQueue: () => mockSync(),
  readPendingFoodLogCount: () => mockReadPending(),
  subscribePendingFoodLogs: (listener: (n: number) => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

import { useFoodLogQueueSync, usePendingFoodLogCount } from '../useFoodLogQueueSync';

let appStateHandler: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  mockSync.mockClear();
  mockReadPending.mockReset();
  mockReadPending.mockResolvedValue(0);
  mockListeners.clear();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useFoodLogQueueSync', () => {
  it('sends waiting foods when a signed-in client opens the app (cold start)', async () => {
    await renderHook(() => useFoodLogQueueSync(true, true));
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while no client is signed in', async () => {
    await renderHook(() => useFoodLogQueueSync(false, true));
    expect(mockSync).not.toHaveBeenCalled();
    expect(appStateHandler).toBeNull();
  });

  it('sends again when the connection returns', async () => {
    const { rerender } = await renderHook(({ online }) => useFoodLogQueueSync(true, online), {
      initialProps: { online: false },
    });
    expect(mockSync).toHaveBeenCalledTimes(1);
    await rerender({ online: true });
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('sends again when the app returns to the foreground', async () => {
    await renderHook(() => useFoodLogQueueSync(true, true));
    expect(mockSync).toHaveBeenCalledTimes(1);
    await act(async () => appStateHandler?.('background'));
    expect(mockSync).toHaveBeenCalledTimes(1);
    await act(async () => appStateHandler?.('active'));
    expect(mockSync).toHaveBeenCalledTimes(2);
  });
});

describe('usePendingFoodLogCount', () => {
  it('reads the waiting count and follows updates', async () => {
    mockReadPending.mockResolvedValue(1);
    const { result } = await renderHook(() => usePendingFoodLogCount());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(1);
    await act(async () => mockListeners.forEach((listener) => listener(0)));
    expect(result.current).toBe(0);
  });
});
