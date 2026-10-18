/**
 * FinishJoining (B-PACKAGE-135) — Home's one-line mount. While a paid
 * coach-code join is unpaid it shows "Finish joining <coach first name>",
 * which opens the package screen again (JoinPackageHost), marked resumed so
 * the screen re-reads the saved join (FIX712). The row goes once the account
 * has a coach (the purchase attached it).
 */
import React, { useEffect, useState } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  clearPendingJoin,
  coachNameOf,
  readPendingJoin,
  showJoin,
  subscribeJoin,
  type JoinOutcome,
} from '../../lib/joinPackage';
import { QuietRow, QuietSection } from '../../ui';
import { useNoticeSlot } from '../home/HomeNoticeSlot';

export default function FinishJoining() {
  const user = useCurrentUser();
  const [pending, setPending] = useState<JoinOutcome | null>(null);

  useEffect(() => {
    let live = true;
    const sync = () => {
      void readPendingJoin().then((next) => {
        if (live) setPending(next);
      });
    };
    sync();
    const unsubscribe = subscribeJoin(sync);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const coachId = user?.coach_id ?? null;
  useEffect(() => {
    if (pending && coachId) void clearPendingJoin();
  }, [coachId, pending]);

  const shown = useNoticeSlot('finishJoining', !!pending && !!user && !coachId); // one notice at a time on the rings Home
  if (!shown || !pending) return null;
  return (
    <QuietSection testID="finish-joining">
      <QuietRow
        label={`Finish joining ${coachNameOf(pending)}`}
        detail={pending.package.name || undefined}
        onPress={() => showJoin(pending, true)}
        accessibilityHint="Opens the package and its payment"
        testID="finish-joining-row"
      />
    </QuietSection>
  );
}
