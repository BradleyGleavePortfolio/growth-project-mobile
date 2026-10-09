// START-HANG-134 (B35, B37): the startup time limit and the latest-run guard.
import {
  STARTUP_STEP_TIMEOUT_MS,
  StartupTimeoutError,
  createLatestRunGuard,
  isStartupTimeout,
  withStartupTimeout,
} from '../startupTimebox';

describe('withStartupTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes an answer or a failure through and clears its timer', async () => {
    await expect(withStartupTimeout(Promise.resolve('ok'), 'read')).resolves.toBe('ok');
    const err = new Error('network');
    await expect(withStartupTimeout(Promise.reject(err), 'read')).rejects.toBe(err);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a promise that never settles rejects with StartupTimeoutError after 8 s, not before', async () => {
    let settled = false;
    const outcome = withStartupTimeout(new Promise<string>(() => undefined), 'first win').catch((e: unknown) => {
      settled = true;
      return e;
    });
    await jest.advanceTimersByTimeAsync(STARTUP_STEP_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const err = await outcome;
    expect(isStartupTimeout(err)).toBe(true);
    expect((err as StartupTimeoutError).step).toBe('first win');
    expect(isStartupTimeout(new Error('x'))).toBe(false);
  });

  it('a failure that lands after the limit is absorbed (no unhandled rejection)', async () => {
    let fail: (e: Error) => void = () => undefined;
    const late = new Promise<string>((_, reject) => {
      fail = reject;
    });
    const outcome = withStartupTimeout(late, 'coach setup', 100).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(100);
    expect(isStartupTimeout(await outcome)).toBe(true);
    fail(new Error('late'));
    await Promise.resolve();
  });
});

it('createLatestRunGuard: the latest run wins; an overtaken run stays overtaken', () => {
  const guard = createLatestRunGuard();
  const first = guard.begin();
  expect(first()).toBe(true);
  const second = guard.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
});
