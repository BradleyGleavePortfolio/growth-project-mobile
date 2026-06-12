/**
 * FirstPaymentWowHost — the coach-shell overlay owner for ED.3 (spec §2.6).
 *
 * Mounted once near the top of the coach navigator. It:
 *   1. Reads the signed-in coach id (useCurrentUser).
 *   2. Opens the Supabase realtime subscription (useFirstPaymentRealtime),
 *      gated behind featureFlags.romanFirstPaymentWow.
 *   3. On the coach's FIRST (gate-unseen) payment INSERT, stores the event and
 *      overlays FirstPaymentWowScreen across the whole shell.
 *   4. On dismiss, writes the MMKV gate (markFirstPaymentSeen) BEFORE clearing
 *      the overlay, so a re-render / re-subscribe can never re-trigger it
 *      (once-only contract). "Navigate back to coach home" = unmount the
 *      overlay; the coach is returned to whatever tab they were on.
 *
 * The host renders its children unchanged and lays the overlay on top only
 * while an event is pending — so when the flag is OFF or the gate is closed it
 * is a transparent pass-through with zero behavioural change to the shell.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { featureFlags } from '../../../config/featureFlags';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import FirstPaymentWowScreen from './FirstPaymentWowScreen';
import {
  useFirstPaymentRealtime,
  type FirstPaymentEvent,
} from './useFirstPaymentRealtime';
import { markFirstPaymentSeen } from './firstPaymentGate';

export interface FirstPaymentWowHostProps {
  readonly children: React.ReactNode;
}

export default function FirstPaymentWowHost({
  children,
}: FirstPaymentWowHostProps): React.ReactElement {
  const user = useCurrentUser();
  const coachId = user?.id;
  // Resolve the coach's display name in the operator-chosen form (§6). We use
  // the cached user's first name; the celebration copy reads naturally with it.
  const coachName = (user?.firstName ?? user?.name ?? 'Coach').trim() || 'Coach';

  const [event, setEvent] = useState<FirstPaymentEvent | null>(null);

  const handleFirstPayment = useCallback((next: FirstPaymentEvent) => {
    // Only the first event wins; later INSERTs while the overlay is up are
    // ignored (the gate is written on dismiss).
    setEvent((current) => current ?? next);
  }, []);

  useFirstPaymentRealtime({
    coachId,
    enabled: featureFlags.romanFirstPaymentWow && Boolean(coachId),
    onFirstPayment: handleFirstPayment,
  });

  const handleDismiss = useCallback(async () => {
    // Close the gate (await its persistence) FIRST so the celebration can never
    // re-arm, THEN clear the overlay (return to coach home). On a write failure
    // we log via console.warn — never swallow (Bradley Law #36) — but STILL
    // clear the UI so the coach is never trapped behind the overlay.
    if (coachId) {
      try {
        await markFirstPaymentSeen(coachId);
      } catch (err) {
        console.warn(
          '[FirstPaymentWowHost] markFirstPaymentSeen failed',
          err,
        );
      }
    }
    setEvent(null);
  }, [coachId]);

  return (
    <View style={styles.root}>
      {children}
      {event && (
        <FirstPaymentWowScreen
          coachName={coachName}
          amount={event.amount}
          clientName={event.clientName}
          onDismiss={handleDismiss}
          testID="first-payment-wow"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
