/**
 * S-COACH-MOB-2 — one loadable section of the Money page. Each section loads,
 * fails and retries on its own, so one slow route never blanks the page.
 * The last good data is kept while a reload runs or fails (offline), with
 * the time it was loaded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";

export interface Section<T> {
  data: T | null;
  error: FriendlyError | null;
  loading: boolean;
  loadedAt: number | null;
  reload: () => Promise<void>;
}

export function useSection<T>(
  fetcher: () => Promise<T>,
  action: string,
  deps: readonly unknown[],
): Section<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await fetcher();
      if (!alive.current || mine !== seq.current) return;
      setData(d);
      setLoadedAt(Date.now());
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      setError(describeError(err, action));
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
    // `deps` are the fetcher's inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, loadedAt, reload };
}
