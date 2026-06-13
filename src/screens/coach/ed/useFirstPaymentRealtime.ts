/**
 * useFirstPaymentRealtime — ED.3 trigger.
 *
 * Subscribes to the coach's purchases table over Supabase realtime and fires a
 * callback the first time a payment for THIS coach reaches SUCCESS — but only
 * if the once-only MMKV gate (firstPaymentGate) has not already been closed.
 * The celebration screen (spec section 2.6) is the consumer.
 *
 * BACKEND SOURCE OF TRUTH (read-only; R69 forbids changing it). The checked-in
 * backend models purchases as the ClientPurchase model in
 * backend-base/prisma/schema.prisma:3449-3532. That model has NO @@map, so its
 * physical Postgres table name is the model name verbatim: ClientPurchase. The
 * tenant column is coach_user_id (indexed [coach_user_id, status],
 * schema.prisma:3526). The lifecycle column is status (schema.prisma:3473-3474:
 * pending, paid, active, past_due, canceled, payment_failed, expired). Rows are
 * CREATED pending on both the Checkout-session path (checkout.service.ts:353-366)
 * and the PaymentIntent path (checkout.service.ts:551-563); the webhook then
 * CLAIMS the pending row and UPDATEs it to status paid, entitlement_active true
 * (checkout-webhook-handler.service.ts:850-865). The normal first-success path
 * is therefore a pending-to-paid UPDATE, not an INSERT of an already-successful
 * row, so the subscription must observe the success TRANSITION.
 *
 * Supabase client: this feature is realtime, so we follow the repo's realtime
 * modules (src/api/communityRealtime.ts, src/services/realtime.ts) which import
 * createClient statically. The client is still created lazily inside the effect
 * (only when the flag is on AND the gate is unseen), hydrated with the coach's
 * existing session token from secureStorage (the same token api.ts uses). No
 * new auth scheme, no new persistent global client. The static import is
 * acceptable on cold start because the whole feature is flag-gated.
 *
 * Bradley Law #36 (no swallowed catches): every failure path here LOGS via the
 * shared logger and surfaces through the returned error state. A realtime
 * subscription failure is non-fatal to the coach shell (the app keeps working
 * without the celebration), but it is never silently dropped — the catch
 * records the reason so a missing celebration can be diagnosed.
 *
 * Server-authoritative FIRST-SUCCESSFUL-payment proof. The local once-only gate
 * alone cannot prove a payment is the coach's FIRST, and a bare COUNT(*) cannot
 * prove it is the first SUCCESSFUL one. The three guards here are:
 *
 *   (a) SUCCESS TRANSITION — the candidate is the NEW record reaching a
 *       recognised success status. For an UPDATE we additionally require that
 *       the OLD record, when present, was NOT already a success — that is, the
 *       pending-to-paid transition, not a paid-to-paid no-op. For an INSERT we
 *       accept a row inserted already-successful (a direct success insert). The
 *       single AUTHORITATIVE success column is status (the ClientPurchase
 *       column). A row that carries success only in an alternate field, or
 *       whose status fields conflict, is AMBIGUOUS, so no fire plus log (#36).
 *
 *   (b) PROVABLY FIRST — we query for ANY successful purchase for this coach
 *       strictly EARLIER than the event row (by created_at, tie-break by id),
 *       scoped to coach_user_id plus the success status set. ZERO earlier
 *       successful rows means this is the first successful payment, so
 *       celebrate. Querying for EARLIER rows is race-proof: a later payment
 *       cannot change whether earlier successful rows already exist.
 *
 * FAIL CLOSED: verification error, unknown status, or ambiguous result means no
 * celebration, logged via the shared logger, and the gate is NOT marked seen
 * (a later legitimate event may still verify). When an earlier successful
 * payment is found, we mark seen and close the gate (stop subscribing), no
 * celebration. All on the same authenticated Supabase client — no schema change
 * (R69), no backend change; this is a mobile-only PR.
 */
import { useEffect, useRef, useState } from 'react';
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { env } from '../../../config/env';
import { secureStorage } from '../../../services/secureStorage';
import { errorMessage } from '../../../types/common';
import { logger } from '../../../utils/logger';
import { hasSeenFirstPayment, markFirstPaymentSeen } from './firstPaymentGate';

/**
 * Physical purchases table and columns, taken verbatim from the checked-in
 * backend source of truth. ClientPurchase has no @@map so the table name is the
 * model name; the tenant column is coach_user_id; the lifecycle column is
 * status (backend-base/prisma/schema.prisma:3449-3532).
 */
const PURCHASES_TABLE = 'ClientPurchase';
const COACH_COLUMN = 'coach_user_id';
const STATUS_COLUMN = 'status';

/** The shape of a payment row we care about (subset). */
export interface FirstPaymentEvent {
  /** Pre-formatted, human-facing amount string, e.g. "$240.00". */
  readonly amount: string;
  /** Paying client's display name. */
  readonly clientName: string;
}

export interface UseFirstPaymentRealtimeArgs {
  /** The signed-in coach's id. Empty / undefined disables the subscription. */
  readonly coachId: string | undefined;
  /** Master enable (feature flag). When false the hook is inert. */
  readonly enabled: boolean;
  /** Fired once when the coach's FIRST (gate-unseen) successful payment lands. */
  readonly onFirstPayment: (event: FirstPaymentEvent) => void;
}

export interface UseFirstPaymentRealtimeState {
  /** Non-null when the subscription could not be established / errored. */
  readonly error: string | null;
}

/** Format a numeric minor/major amount into a currency string defensively. */
function formatAmount(row: Record<string, unknown>): string {
  // Prefer an already-formatted string column if the backend provides one.
  const preformatted = row.amount_formatted ?? row.display_amount;
  if (typeof preformatted === 'string' && preformatted.length > 0) {
    return preformatted;
  }
  // Else derive from a numeric amount + currency. ClientPurchase persists the
  // charge as amount_cents (schema.prisma:3459), so a cents column is divided
  // into major units; a plain amount column is treated as already in major
  // units. A preformatted string column above takes precedence over both.
  const cents = row.amount_cents;
  const major = row.amount;
  const currency =
    typeof row.currency === 'string' && row.currency.length === 3
      ? row.currency.toUpperCase()
      : 'USD';
  const value =
    typeof cents === 'number'
      ? cents / 100
      : typeof cents === 'string' && cents.trim().length > 0
        ? Number(cents) / 100
        : typeof major === 'number'
          ? major
          : typeof major === 'string'
            ? Number(major)
            : NaN;
  if (!Number.isFinite(value)) return 'your first payment';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(value);
  } catch (err) {
    // Intl currency code unknown on this runtime — fall back without throwing,
    // but record WHY so a malformed currency code is diagnosable (Law #36).
    logger.warn('ed3', 'amount currency format failed; using plain dollars', {
      currency,
      reason: errorMessage(err, 'Intl format failed'),
    });
    return `$${value.toFixed(2)}`;
  }
}

/** Pull the paying client's name out of a row, defensively. */
function readClientName(row: Record<string, unknown>): string {
  const candidates = [row.client_name, row.payer_name, row.customer_name];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return 'your client';
}

/**
 * The success status values a ClientPurchase row may carry. The backend writes
 * a one-time charge to status 'paid' and a subscription seat to 'active'
 * (schema.prisma:3473-3474; the mobile success predicate is status === 'paid'
 * || status === 'active' in src/api/clientPaymentsApi.ts:566,624-626, mirroring
 * checkout.service.ts). Only these two are evidenced as STORED purchase
 * statuses; Stripe wire-level synonyms (succeeded / settled / completed) are
 * NOT columns on this table, so they are intentionally excluded (R69 — wire to
 * the real stored values, do not invent statuses). Matching is case-insensitive
 * and trimmed.
 */
const SUCCESS_STATUSES: readonly string[] = ['paid', 'active'];

/** True when a trimmed, lower-cased status string is a recognised success. */
function isSuccessStatus(value: string): boolean {
  return SUCCESS_STATUSES.includes(value.trim().toLowerCase());
}

/**
 * Success disposition of a record, read from the SINGLE authoritative status
 * column only (the ClientPurchase status column). Alternate fields (state /
 * payment_status) are NOT accepted as success and, when they disagree with
 * status, make the record ambiguous so the celebration fails closed.
 *   'success'   → status is a recognised success value
 *   'nonsuccess'→ status is present but is NOT a success value
 *   'absent'    → no usable status field present → ambiguous → FAIL CLOSED
 *   'conflict'  → status disagrees with an alternate status-like field that
 *                 itself reads success → ambiguous → FAIL CLOSED
 */
type SuccessDisposition = 'success' | 'nonsuccess' | 'absent' | 'conflict';

function rowSuccessDisposition(
  row: Record<string, unknown>,
): SuccessDisposition {
  const rawStatus = row[STATUS_COLUMN];
  const hasStatus =
    typeof rawStatus === 'string' && rawStatus.trim().length > 0;

  // Detect a conflicting success signal in an alternate field. The authoritative
  // column is status; if state / payment_status read success while status does
  // not (or status is absent), the row is ambiguous and must fail closed rather
  // than trust the unauthoritative field.
  const altFields = [row.state, row.payment_status];
  const altSuccess = altFields.some(
    (v) => typeof v === 'string' && isSuccessStatus(v),
  );

  if (!hasStatus) {
    // No authoritative status. A success-looking alternate field is exactly the
    // ambiguous case that previously caused a false 'first'. Treat as ambiguous.
    return altSuccess ? 'conflict' : 'absent';
  }

  const statusSuccess = isSuccessStatus(rawStatus);
  if (statusSuccess) return 'success';
  // Status says non-success but an alternate field claims success → conflict.
  if (altSuccess) return 'conflict';
  return 'nonsuccess';
}

/**
 * Server-authoritative verdict on whether the SUCCESSFUL event we received is
 * the coach's FIRST successful payment. Queries the same authenticated client
 * (no schema change — R69) for successful purchase rows scoped to this coach,
 * ordered by created_at then id, and asks whether ANY successful row exists
 * strictly EARLIER than the event row. This is race-proof: a later payment
 * cannot change whether earlier successful rows already exist.
 *   'first'       → zero earlier successful rows → celebrate
 *   'established' → an earlier successful row exists → never celebrate
 *   'unknown'     → query error / missing ordering key → FAIL CLOSED
 */
async function verifyFirstSuccessfulPayment(
  client: SupabaseClient,
  coachId: string,
  eventRow: Record<string, unknown>,
): Promise<'first' | 'established' | 'unknown'> {
  const createdAt = eventRow.created_at;
  const eventId = eventRow.id;
  // Without a usable ordering key on the event row we cannot prove ordering —
  // FAIL CLOSED rather than guess (Law #36; the caller logs and does not mark
  // seen, so a later well-formed event can still verify).
  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    logger.warn('ed3', 'first-payment event row missing created_at', {});
    return 'unknown';
  }
  // Fetch successful rows for this coach at or before the event's timestamp,
  // earliest first. limit(2) is enough: we only need to know whether any row
  // OTHER than the event itself precedes it.
  const { data, error: queryError } = await client
    .from(PURCHASES_TABLE)
    .select('id, created_at, status')
    .eq(COACH_COLUMN, coachId)
    .in(STATUS_COLUMN, SUCCESS_STATUSES as string[])
    .lte('created_at', createdAt)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(2);
  if (queryError) {
    // Do not throw — the caller fails closed on 'unknown' and logs the reason.
    logger.warn('ed3', 'first-payment verification query returned error', {
      reason: queryError.message,
    });
    return 'unknown';
  }
  if (!Array.isArray(data)) return 'unknown';
  // Is there a successful row that is strictly earlier than the event row?
  const hasEarlier = data.some((r) => {
    const rId = (r as Record<string, unknown>).id;
    const rCreated = (r as Record<string, unknown>).created_at;
    if (rId === eventId) return false; // the event row itself is not 'earlier'
    if (typeof rCreated !== 'string') return false;
    if (rCreated < createdAt) return true;
    // Same timestamp → tie-break by id (stable, deterministic ordering).
    if (rCreated === createdAt) {
      return String(rId) < String(eventId);
    }
    return false;
  });
  return hasEarlier ? 'established' : 'first';
}

export function useFirstPaymentRealtime({
  coachId,
  enabled,
  onFirstPayment,
}: UseFirstPaymentRealtimeArgs): UseFirstPaymentRealtimeState {
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callback without re-subscribing on every render.
  const cbRef = useRef(onFirstPayment);
  cbRef.current = onFirstPayment;

  useEffect(() => {
    if (!enabled || !coachId) return undefined;

    let cancelled = false;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;

    /**
     * Evaluate a realtime payload (INSERT or UPDATE) for the coach's first
     * successful payment, applying every fail-closed guard. Shared by both
     * event handlers so the INSERT-as-paid and pending-to-paid UPDATE paths run
     * identical proof logic.
     */
    function evaluatePayload(
      eventType: 'INSERT' | 'UPDATE',
      newRow: Record<string, unknown>,
      oldRow: Record<string, unknown> | null,
    ): void {
      // Re-check the gate at fire time, THEN prove server-side that this is
      // genuinely the coach's FIRST SUCCESSFUL payment before celebrating.
      // Every guard fails closed (Law #36).
      hasSeenFirstPayment(coachId as string)
        .then(async (already) => {
          if (already || cancelled || !client) return;

          // Guard (a): the NEW record must itself be a recognised success on the
          // authoritative status column. Ambiguous (alternate-only / absent /
          // conflicting) records do NOT celebrate and do NOT mark the gate seen.
          const disposition = rowSuccessDisposition(newRow);
          if (disposition !== 'success') {
            logger.log(
              'ed3',
              'payment event is not an authoritative success; gate left unseen',
              { event: eventType, disposition },
            );
            return;
          }

          // Guard (a, transition): for an UPDATE, require the OLD record (when
          // present) to NOT already be a success, so we celebrate the
          // pending-to-paid transition and never a paid-to-paid no-op update.
          // INSERTs are accepted as a direct success insert (no prior state).
          if (eventType === 'UPDATE' && oldRow) {
            const oldDisposition = rowSuccessDisposition(oldRow);
            if (oldDisposition === 'success') {
              logger.log(
                'ed3',
                'update did not transition into success; ignoring no-op',
                { event: eventType },
              );
              return;
            }
          }

          // Guard (b): prove this is the FIRST successful payment.
          const verdict = await verifyFirstSuccessfulPayment(
            client,
            coachId as string,
            newRow,
          );
          if (cancelled) return;
          if (verdict === 'established') {
            // An earlier successful payment exists — this coach is past their
            // first. Close the local gate so we stop re-arming on future opens,
            // and never celebrate.
            logger.log(
              'ed3',
              'established coach payment; suppressing celebration and closing gate',
            );
            await markFirstPaymentSeen(coachId as string);
            return;
          }
          if (verdict !== 'first') {
            // 'unknown' — verification could not prove the first success. FAIL
            // CLOSED: do not celebrate, do not mark seen. Already logged.
            return;
          }
          cbRef.current({
            amount: formatAmount(newRow),
            clientName: readClientName(newRow),
          });
        })
        .catch((err) => {
          // Gate re-check / verification failed — do not swallow (Law #36). We
          // skip firing (fail-closed) and record why the celebration was
          // suppressed on this event.
          logger.warn('ed3', 'first-payment verification failed', {
            reason: errorMessage(err, 'verification failed'),
          });
        });
    }

    async function subscribe(): Promise<void> {
      try {
        // If the celebration has already fired for this coach, do not even
        // open the channel — the moment is spent (once-only contract).
        const seen = await hasSeenFirstPayment(coachId as string);
        if (seen || cancelled) return;

        const [accessToken, refreshToken] = await Promise.all([
          secureStorage.getItem('supabase_token'),
          secureStorage.getItem('supabase_refresh_token'),
        ]);
        if (!accessToken) {
          // Not signed into Supabase — nothing to subscribe to. This is a
          // benign state (the celebration simply will not fire), but we record
          // it rather than swallow it (Law #36).
          logger.log('ed3', 'no supabase session token; realtime not started');
          return;
        }

        if (cancelled) return;
        client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
        if (refreshToken) {
          await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        }
        if (cancelled) return;

        const tenantFilter = `${COACH_COLUMN}=eq.${coachId}`;
        channel = client
          .channel(`ed3-first-payment-${coachId}`)
          .on(
            'postgres_changes',
            {
              // The normal first-success path is the webhook's pending-to-paid
              // UPDATE (checkout-webhook-handler.service.ts:850-865), so the
              // transition is observed here. evaluatePayload requires the OLD
              // record to NOT already be a success.
              event: 'UPDATE',
              schema: 'public',
              table: PURCHASES_TABLE,
              filter: tenantFilter,
            },
            (payload) => {
              const newRow = (payload.new ?? {}) as Record<string, unknown>;
              const rawOld = payload.old as unknown;
              const oldRow =
                rawOld && typeof rawOld === 'object'
                  ? (rawOld as Record<string, unknown>)
                  : null;
              evaluatePayload('UPDATE', newRow, oldRow);
            },
          )
          .on(
            'postgres_changes',
            {
              // Keep INSERT handling for any flow that inserts a row already in
              // a success status (a direct success insert). evaluatePayload
              // still fails closed and still runs the firstness proof.
              event: 'INSERT',
              schema: 'public',
              table: PURCHASES_TABLE,
              filter: tenantFilter,
            },
            (payload) => {
              const newRow = (payload.new ?? {}) as Record<string, unknown>;
              evaluatePayload('INSERT', newRow, null);
            },
          )
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              // Surface the transport failure — do not swallow (Law #36).
              if (!cancelled) setError(`Realtime channel ${status}`);
              logger.warn('ed3', 'realtime channel status', { status });
            }
          });
      } catch (err) {
        const message = errorMessage(err, 'First-payment realtime failed');
        if (!cancelled) setError(message);
        // Never swallow — record the reason the celebration cannot arm.
        logger.error('ed3', 'first-payment realtime subscribe failed', {
          reason: message,
        });
      }
    }

    void subscribe();

    return () => {
      cancelled = true;
      try {
        if (channel) channel.unsubscribe();
        if (client) {
          // removeAllChannels() returns a promise; a cleanup cannot be async,
          // so we capture the promise and attach a rejection handler rather
          // than swallow it (Law #36).
          Promise.resolve(client.removeAllChannels()).catch((err) => {
            logger.warn('ed3', 'removeAllChannels failed', {
              reason: errorMessage(err, 'removeAllChannels failed'),
            });
          });
        }
      } catch (err) {
        // Teardown failure is non-fatal but must be recorded (Law #36).
        logger.warn('ed3', 'realtime teardown failed', {
          reason: errorMessage(err, 'teardown failed'),
        });
      }
    };
  }, [coachId, enabled]);

  return { error };
}
