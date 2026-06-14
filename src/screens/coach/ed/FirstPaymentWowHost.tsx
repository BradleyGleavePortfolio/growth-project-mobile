/**
 * FirstPaymentWowHost — the coach-shell overlay owner for ED.3 (spec §2.6).
 *
 * Mounted once near the top of the coach navigator. It:
 *   1. Reads the signed-in coach id (useCurrentUser).
 *   2. Subscribes to the FIRST_PAYMENT domain notification
 *      (useFirstPaymentNotification), gated behind
 *      featureFlags.romanFirstPaymentWow.
 *   3. On the coach's FIRST (gate-unseen) FIRST_PAYMENT notification, formats the
 *      payload { amount, currency, clientId } into the celebration's display
 *      strings and overlays FirstPaymentWowScreen across the whole shell.
 *   4. On dismiss, writes the MMKV gate (markFirstPaymentSeen) BEFORE clearing
 *      the overlay, so a re-render / re-subscribe can never re-trigger it
 *      (once-only contract). "Navigate back to coach home" = unmount the
 *      overlay; the coach is returned to whatever tab they were on.
 *
 * Why a notification, not a payment-table read (Option C — see
 * ROMAN_ED3_REWRITE_PLAN.md): the backend owns the "first payment" decision
 * inside the same DB transaction that confirms the payment, exactly-once via a
 * UNIQUE(coach_user_id) row, and emits a normal domain notification. The mobile
 * client never reads ClientPurchase directly — no payment-correctness coupling,
 * no RLS surface, no client-side count===1 race. This replaced the dangerous
 * client-side purchase counting that PR #242 originally carried.
 *
 * The host renders its children unchanged and lays the overlay on top only
 * while an event is pending — so when the flag is OFF or the gate is closed it
 * is a transparent pass-through with zero behavioural change to the shell.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { featureFlags } from '../../../config/featureFlags';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import {
  useFirstPaymentNotification,
  type FirstPaymentNotificationPayload,
} from '../../../hooks/useNotifications';
import { errorMessage } from '../../../types/common';
import { logger } from '../../../utils/logger';
import FirstPaymentWowScreen from './FirstPaymentWowScreen';
import { markFirstPaymentSeen } from './firstPaymentGate';

export interface FirstPaymentWowHostProps {
  readonly children: React.ReactNode;
}

/** The display-ready celebration event derived from the notification payload. */
interface FirstPaymentDisplayEvent {
  /** Pre-formatted, human-facing amount string, e.g. "$240.00". */
  readonly amount: string;
  /** Paying client's display name. The payload carries no name, so this is a
   *  calm generic ("your client") — the celebration reads naturally with it. */
  readonly clientName: string;
}

/**
 * Format the fixed { amount, currency } payload into a human-facing currency
 * string. Defensive: an unknown currency code on this runtime falls back to a
 * plain "$X.XX" rather than throwing (the moment still lands through the copy),
 * and the failure reason is logged (Law #36).
 */
export function formatPaymentAmount(amount: number, currency: string): string {
  const code =
    typeof currency === 'string' && currency.trim().length === 3
      ? currency.trim().toUpperCase()
      : 'USD';
  if (!Number.isFinite(amount)) return 'your first payment';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(amount);
  } catch (err) {
    logger.warn('ed3', 'amount currency format failed; using plain dollars', {
      currency: code,
      reason: errorMessage(err, 'Intl format failed'),
    });
    return `$${amount.toFixed(2)}`;
  }
}

export default function FirstPaymentWowHost({
  children,
}: FirstPaymentWowHostProps): React.ReactElement {
  const user = useCurrentUser();
  const coachId = user?.id;
  // Resolve the coach's display name in the operator-chosen form (§6). We use
  // the cached user's first name; the celebration copy reads naturally with it.
  const coachName = (user?.firstName ?? user?.name ?? 'Coach').trim() || 'Coach';

  const [event, setEvent] = useState<FirstPaymentDisplayEvent | null>(null);

  // Session-local dismissed/seen latch (audit R2 P1), keyed BY COACH (audit R3
  // P2). The persisted gate alone is not enough: if markFirstPaymentSeen
  // rejects (storage outage), the gate stays unseen and a later notification
  // could re-fire onFirstPayment after the coach has already dismissed the
  // celebration this session. This in-memory set records WHICH coaches have
  // dismissed this session, INDEPENDENT of whether persistence succeeded — the
  // dismissed coach is added BEFORE the overlay clears. Keying by coach (rather
  // than a single host-lifetime boolean) means coach A dismissing never
  // suppresses coach B's legitimate first-payment celebration in the same
  // session; re-firing for coach A is still blocked.
  const dismissedCoachIdsRef = useRef<Set<string>>(new Set<string>());

  const handleFirstPayment = useCallback(
    (payload: FirstPaymentNotificationPayload) => {
      // Once THIS coach dismissed this session, never re-show for them — even
      // if the persisted gate failed to write. A different coach is unaffected.
      if (coachId && dismissedCoachIdsRef.current.has(coachId)) return;
      const next: FirstPaymentDisplayEvent = {
        amount: formatPaymentAmount(payload.amount, payload.currency),
        // The fixed payload carries clientId only (no name) — the backend does
        // not leak the client's name into this notification. The celebration
        // reads naturally with a calm generic.
        clientName: 'your client',
      };
      // Only the first event wins; later notifications while the overlay is up
      // are ignored (the gate is written on dismiss).
      setEvent((current) => current ?? next);
    },
    [coachId],
  );

  const enabled = useMemo(
    () => featureFlags.romanFirstPaymentWow && Boolean(coachId),
    [coachId],
  );

  const { error: notificationError } = useFirstPaymentNotification({
    coachId,
    enabled,
    onFirstPayment: handleFirstPayment,
  });

  // Consume the hook's error state at the overlay owner (audit R2 P2). This is
  // a background showpiece, so we do NOT add user-facing noise — but we never
  // swallow it (Law #36): a subscription failure means the celebration may be
  // silently absent, so we route it to the shared logger for diagnosis.
  useEffect(() => {
    if (notificationError) {
      logger.warn('ed3', 'first-payment notification error surfaced at host', {
        reason: notificationError,
      });
    }
  }, [notificationError]);

  const handleDismiss = useCallback(async () => {
    // Set the session latch FIRST (for THIS coach) so the celebration can never
    // re-show this session for them regardless of whether the persisted gate
    // write below succeeds. Other coaches remain eligible to celebrate.
    if (coachId) dismissedCoachIdsRef.current.add(coachId);
    // Close the persisted gate (await it) so a future session also stays
    // closed, THEN clear the overlay (return to coach home). On a write
    // failure we log via the shared logger — never swallow (Bradley Law #36)
    // — but STILL clear the UI so the coach is never trapped behind the
    // overlay; the session latch already blocks any re-show.
    if (coachId) {
      try {
        await markFirstPaymentSeen(coachId);
      } catch (err) {
        logger.warn('ed3', 'markFirstPaymentSeen failed', { error: err });
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
