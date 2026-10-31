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
 * ─── Roman P4 / ED.3 contract (first payment) ───────────────────────────────
 *
 * The backend emits one in-app row when a coach's FIRST successful payment is
 * confirmed (kind 'first_payment', exactly once per coach). The mobile client
 * never reads the ClientPurchase table: it watches the notification stream and
 * shows the celebration when that row arrives.
 *
 * B-LSNOTIFY3-2: the row is decoded in one place, normalizeNotification
 * (src/services/notificationsApi.ts decodeFirstPayment), into
 * AppNotification.firstPayment { amount (major units), currency, clientId }.
 * This hook reads only that field. The old local 'FIRST_PAYMENT' kind and
 * actionParams carrier never matched a real backend row and are gone.
 *
 * Bradley Law #36 (no swallowed catches): every failure path here LOGS via the
 * shared logger and surfaces through the returned error state. A polling failure
 * is non-fatal to the shell (the celebration simply will not fire), but it is
 * never silently dropped.
 */
import { useEffect, useRef, useState } from 'react';
import { fetchNotifications, type FirstPaymentEvent } from '../services/notificationsApi';
import { errorMessage } from '../types/common';
import { logger } from '../utils/logger';

/** The first-payment event the celebration reads (major units, upper-case ISO 4217). */
export type FirstPaymentNotificationPayload = FirstPaymentEvent;

export interface UseFirstPaymentNotificationArgs {
  /** The signed-in coach's id. Empty / undefined disables the subscription. */
  readonly coachId: string | undefined;
  /** Master enable (feature flag). When false the hook is inert. */
  readonly enabled: boolean;
  /**
   * Fired once when the first-payment row for this coach is observed.
   * The exactly-once durability lives in the consuming surface (the MMKV gate);
   * this hook guards within-session duplicates via a synchronous latch.
   */
  readonly onFirstPayment: (payload: FirstPaymentNotificationPayload) => void;
  /**
   * Poll interval in ms for the notification stream. The backend delivers
   * the first payment as a normal notification, so this rides the same cadence as
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
 * Subscribe to the first-payment notification for the signed-in coach. ADDITIVE
 * over the existing notification stream — no direct payment-table reads.
 *
 * On the first first-payment row observed for this coach, calls
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
     * Read a page of notifications and, if a first-payment row for this coach is
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

      // Only a first_payment row whose payload decoded carries firstPayment;
      // a malformed one fails closed in the normalizer (logged there).
      const payload = page.items.find((n) => n.firstPayment)?.firstPayment;
      if (!payload) return;

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
