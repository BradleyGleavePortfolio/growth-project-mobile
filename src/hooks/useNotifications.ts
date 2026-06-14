/**
 * useNotifications — additive subscription layer over the app's notification
 * stream (src/services/notificationsApi.ts).
 *
 * This hook lets a surface react to a specific NotificationKind as it arrives,
 * without each surface having to own polling/cursor bookkeeping. It is ADDITIVE:
 * it does not change the existing notificationsApi read path, the
 * NotificationCenterScreen, or any other consumer — it layers a thin
 * per-kind subscription on top of the same data source the rest of the app
 * already uses (Apple-grade single source of truth: the notification stream).
 *
 * ─── Roman P4 / ED.3 contract (FIRST_PAYMENT) ───────────────────────────────
 *
 * The backend Option C workstream (ROMAN_ED3_REWRITE_PLAN.md) emits a domain
 * notification when a coach's FIRST successful payment is confirmed, INSIDE the
 * same DB transaction that flips the purchase to a successful status, guarded by
 * a UNIQUE(coach_user_id) row so it is exactly-once under webhook retries. The
 * mobile client never reads the ClientPurchase table directly any more (that was
 * the dangerous client-side counting removed from PR #242): it simply subscribes
 * to this notification and shows the celebration when it arrives.
 *
 * Fixed string contract with the backend workstream:
 *   kind:    'FIRST_PAYMENT'
 *   payload: { amount: number; currency: string; clientId: string }
 *
 * The backend's FIRST_PAYMENT enum constant has not yet been generated into the
 * mobile shared types (its PR has not merged), so the kind string is declared
 * locally below with a TODO to remove the local const once the backend enum
 * lands. The STRING value is the fixed contract; this local const only avoids a
 * dangling reference until the generated type exists.
 *
 * Bradley Law #36 (no swallowed catches): every failure path here LOGS via the
 * shared logger and surfaces through the returned error state. A polling failure
 * is non-fatal to the shell (the celebration simply will not fire), but it is
 * never silently dropped.
 */
import { useEffect, useRef, useState } from 'react';
import { fetchNotifications } from '../services/notificationsApi';
import { errorMessage } from '../types/common';
import { logger } from '../utils/logger';

/**
 * TODO(roman-p4): remove once backend FIRST_PAYMENT enum lands and is generated
 * into the shared notification types (then import the generated constant here
 * instead of declaring it locally). The STRING value is the fixed cross-repo
 * contract; only this local declaration is temporary.
 */
export const FIRST_PAYMENT_KIND = 'FIRST_PAYMENT' as const;

/**
 * Payload shape emitted by the backend FIRST_PAYMENT notification. Fixed
 * contract with the backend Option C workstream — read EXACTLY this shape.
 */
export interface FirstPaymentNotificationPayload {
  /** Charge amount in major currency units (e.g. 240 for $240.00). */
  readonly amount: number;
  /** ISO 4217 currency code, e.g. "USD". */
  readonly currency: string;
  /** The paying client's user id. The payload deliberately carries no name. */
  readonly clientId: string;
}

/**
 * The minimal carrier shape the FIRST_PAYMENT payload is read from. The base
 * AppNotification does not type a structured payload (its kinds are
 * informational), so the FIRST_PAYMENT body rides the notification's
 * serialisable `actionParams` (the transport the existing notification model
 * already carries). We accept this narrow shape so the parser is decoupled from
 * the full AppNotification type until the backend enum + payload type land.
 */
export interface FirstPaymentCarrier {
  /** Present on FIRST_PAYMENT notifications; serialisable string map. */
  readonly actionParams?: Record<string, string>;
}

/**
 * Parse the fixed FIRST_PAYMENT payload from a notification's serialisable
 * params. Returns null when any required field is absent or malformed, so the
 * caller fails closed (no celebration on a malformed payload) rather than
 * showing a celebration with missing data. Never throws.
 */
export function parseFirstPaymentPayload(
  notification: FirstPaymentCarrier,
): FirstPaymentNotificationPayload | null {
  const params = notification.actionParams;
  if (!params || typeof params !== 'object') return null;

  const rawAmount = params.amount;
  const currency = params.currency;
  const clientId = params.clientId;

  const amount =
    typeof rawAmount === 'string' && rawAmount.trim().length > 0
      ? Number(rawAmount)
      : NaN;
  if (!Number.isFinite(amount)) return null;
  if (typeof currency !== 'string' || currency.trim().length === 0) return null;
  if (typeof clientId !== 'string' || clientId.trim().length === 0) return null;

  return { amount, currency: currency.trim(), clientId: clientId.trim() };
}

export interface UseFirstPaymentNotificationArgs {
  /** The signed-in coach's id. Empty / undefined disables the subscription. */
  readonly coachId: string | undefined;
  /** Master enable (feature flag). When false the hook is inert. */
  readonly enabled: boolean;
  /**
   * Fired once when a FIRST_PAYMENT notification for this coach is observed.
   * The exactly-once durability lives in the consuming surface (the MMKV gate);
   * this hook guards within-session duplicates via a synchronous latch.
   */
  readonly onFirstPayment: (payload: FirstPaymentNotificationPayload) => void;
  /**
   * Poll interval in ms for the notification stream. The backend delivers
   * FIRST_PAYMENT as a normal notification, so this rides the same cadence as
   * the rest of the notification surface. Defaults to 30s.
   */
  readonly pollIntervalMs?: number;
}

export interface UseFirstPaymentNotificationState {
  /** Non-null when the subscription could not read the notification stream. */
  readonly error: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * Subscribe to the FIRST_PAYMENT notification for the signed-in coach. ADDITIVE
 * over the existing notification stream — no direct payment-table reads.
 *
 * On the first FIRST_PAYMENT notification observed for this coach, calls
 * onFirstPayment with the parsed { amount, currency, clientId } payload. A
 * synchronous per-coach latch guarantees onFirstPayment is called at most once
 * per coach within a session; the durable once-only contract is owned by the
 * consuming surface's persisted gate.
 */
export function useFirstPaymentNotification({
  coachId,
  enabled,
  onFirstPayment,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseFirstPaymentNotificationArgs): UseFirstPaymentNotificationState {
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callback without re-subscribing on every render.
  const cbRef = useRef(onFirstPayment);
  cbRef.current = onFirstPayment;
  // Synchronous exactly-once latch, keyed by coachId. Set immediately BEFORE
  // the callback dispatch so duplicate observations of the same notification
  // (across poll ticks) can never double-call onFirstPayment within a session.
  const firedLatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !coachId) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    /**
     * Read a page of notifications and, if a FIRST_PAYMENT for this coach is
     * present and not yet dispatched this session, fire the callback exactly
     * once. Every failure path logs and surfaces; none are swallowed (Law #36).
     */
    async function poll(): Promise<void> {
      if (firedLatchRef.current === coachId) return;
      let page;
      try {
        page = await fetchNotifications(null);
      } catch (err) {
        const message = errorMessage(err, 'notification stream read failed');
        if (!cancelled) setError(message);
        logger.warn('ed3', 'first-payment notification read failed', {
          reason: message,
        });
        return;
      }
      if (cancelled || firedLatchRef.current === coachId) return;

      // The FIRST_PAYMENT kind is not yet in the generated AppNotification kind
      // union (backend enum not merged), so compare on the string value rather
      // than narrowing against the union. String() keeps this type-safe without
      // an `as any` cast.
      const match = page.items.find(
        (n) => String(n.kind) === FIRST_PAYMENT_KIND,
      );
      if (!match) return;

      const payload = parseFirstPaymentPayload(match as FirstPaymentCarrier);
      if (!payload) {
        // Malformed payload — fail closed (no celebration) but record why so a
        // missing celebration is diagnosable (Law #36).
        logger.warn(
          'ed3',
          'FIRST_PAYMENT notification payload malformed; not firing',
          { notificationId: match.id },
        );
        return;
      }

      // Set the synchronous latch BEFORE dispatch so a concurrent/duplicate
      // poll observation cannot also fire.
      firedLatchRef.current = coachId as string;
      cbRef.current(payload);
    }

    void poll();
    timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [coachId, enabled, pollIntervalMs]);

  return { error };
}
