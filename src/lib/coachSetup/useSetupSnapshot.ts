/**
 * S-COACH — the one setup read behind the Home checklist and the UI-2 zero-client Home. It reads each time the
 * screen comes into focus, so a package made or a link shared elsewhere ticks on return, and again on `reload`.
 * Only the newest read writes, nothing writes after unmount, and a snapshot is shown only for the read that
 * produced it, so a change of coach never shows the last coach's ticks. A read that throws becomes a snapshot with
 * every tick unknown and the checklist's own error copy. `read` must be stable (a module function or a memo); null
 * reads nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { describeError } from './errors';
import type { SetupSnapshot } from './setupStatus';

export type SetupRead = () => Promise<SetupSnapshot>;

export function useSetupSnapshot(read: SetupRead | null) {
  const [got, setGot] = useState<{ read: SetupRead; snap: SetupSnapshot } | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => () => { seq.current += 1; }, []);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    if (!read) return;
    setLoading(true);
    void Promise.resolve().then(read)
      .catch((err: unknown): SetupSnapshot => ({
        connect: null, livePackageTitle: null, hasClient: null, paid: null, sharedLink: false,
        errors: [describeError(err, 'check your setup')],
      }))
      .then((snap) => { if (mine === seq.current) { setGot({ read, snap }); setLoading(false); } });
  }, [read]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { snap: got && got.read === read ? got.snap : null, loading: loading && read !== null, reload };
}
