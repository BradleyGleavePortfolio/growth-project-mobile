/**
 * START-HANG-134 (B35, B37): the one time limit for the app's start. Every
 * check the app waits on before its first screen goes through
 * `withStartupTimeout`; no answer within the limit rejects with
 * StartupTimeoutError and the caller falls back the way that path already
 * does on a failure. The work is not cancelled; a late answer is ignored.
 * STARTUP_CEILING_MS bounds the loading view itself (then: calm error).
 */

/** About 8 s per startup check (owner brief B35-B37). */
export const STARTUP_STEP_TIMEOUT_MS = 8000;

/** The longest the startup loading view shows before the calm error screen. */
export const STARTUP_CEILING_MS = 15000;

export class StartupTimeoutError extends Error {
  readonly step: string;

  constructor(step: string, ms: number) {
    super(`Startup step "${step}" did not answer within ${ms} ms`);
    this.name = 'StartupTimeoutError';
    this.step = step;
  }
}

export function isStartupTimeout(err: unknown): err is StartupTimeoutError {
  return err instanceof StartupTimeoutError;
}

/**
 * Resolve or reject like `work`, or reject with StartupTimeoutError after
 * `ms`. The timer is cleared as soon as `work` settles, and a rejection of
 * `work` after the limit is absorbed (never an unhandled rejection).
 */
export function withStartupTimeout<T>(
  work: Promise<T>,
  step: string,
  ms: number = STARTUP_STEP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StartupTimeoutError(step, ms)), ms);
  });
  return Promise.race([work, limit]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Re-entrancy guard for a bootstrap that can be started again while it runs
 * (cold start, then an auth event). `begin()` returns a check that stays true
 * only while that run is the latest one: an older run's results are dropped,
 * so the latest bootstrap always wins.
 */
export function createLatestRunGuard(): { begin: () => () => boolean } {
  let latest = 0;
  return {
    begin: () => {
      latest += 1;
      const run = latest;
      return () => run === latest;
    },
  };
}
