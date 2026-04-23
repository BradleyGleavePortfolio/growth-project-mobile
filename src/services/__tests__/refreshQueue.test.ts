import { coalesceRefresh, __resetRefreshQueueForTests } from '../refreshQueue';

describe('refreshQueue — single-flight coalescing', () => {
  beforeEach(() => {
    __resetRefreshQueueForTests();
  });

  it('runs exactly one refresh when N callers request concurrently', async () => {
    const refresh = jest.fn().mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('new-token'), 20)),
    );

    const calls = await Promise.all([
      coalesceRefresh(refresh),
      coalesceRefresh(refresh),
      coalesceRefresh(refresh),
      coalesceRefresh(refresh),
      coalesceRefresh(refresh),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['new-token', 'new-token', 'new-token', 'new-token', 'new-token']);
  });

  it('allows a new refresh after the previous one settles', async () => {
    const refresh = jest.fn().mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');

    const first = await coalesceRefresh(refresh);
    const second = await coalesceRefresh(refresh);

    expect(first).toBe('token-1');
    expect(second).toBe('token-2');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('propagates rejection to all concurrent callers and resets for retry', async () => {
    const failing = jest.fn().mockRejectedValueOnce(new Error('refresh failed'));

    const results = await Promise.allSettled([
      coalesceRefresh(failing),
      coalesceRefresh(failing),
      coalesceRefresh(failing),
    ]);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);

    // After failure, a fresh call should attempt again (the queue self-resets).
    const ok = jest.fn().mockResolvedValue('recovered');
    await expect(coalesceRefresh(ok)).resolves.toBe('recovered');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
