/**
 * useFirstPaymentRealtime — ED.3 trigger.
 *
 * Subscribes to the coach's `payments` table over Supabase realtime and fires
 * a callback the first time an INSERT lands for THIS coach — but only if the
 * once-only MMKV gate (firstPaymentGate) has not already been closed. The
 * celebration screen (spec §2.6) is the consumer.
 *
 * Supabase client: this feature is realtime, so we follow the repo's realtime
 * modules (src/api/communityRealtime.ts, src/services/realtime.ts) which import
 * `createClient` statically. The client is still created lazily inside the
 * effect (only when the flag is on AND the gate is unseen), hydrated with the
 * coach's existing session token from secureStorage (the same token api.ts
 * uses). No new auth scheme, no new persistent global client. The static
 * import is acceptable on cold start because the whole feature is flag-gated.
 *
 * Bradley Law #36 (no swallowed catches): every failure path here LOGS via the
 * shared logger and surfaces through the returned `error` state. A realtime
 * subscription failure is non-fatal to the coach shell (the app keeps working
 * without the celebration), but it is never silently dropped — the catch
 * records the reason so a missing celebration can be diagnosed.
 *
 * Server-authoritative FIRST-SUCCESSFUL-payment proof (audit R3 P1): the local
 * once-only gate alone cannot prove a payment is the coach's FIRST, and a bare
 * COUNT(*) cannot prove it is the first SUCCESSFUL one. The two guards here are:
 *
 *   (a) INSERTED-ROW SUCCESS — the celebration only arms when the inserted
 *       payment row is itself a successful/settled payment. A failed / pending
 *       / refunded INSERT is ignored and does NOT mark the gate seen, so a
 *       later genuine paid row can still verify. Success is read from the
 *       row's status field against the repo's documented success set —
 *       `paid` / `active` (`ClientPurchase.status`, schema.prisma:3214, used as
 *       the success predicate `status IN ('paid','active')` in
 *       src/api/clientPaymentsApi.ts:566,624-626 / checkout.service.ts:723-727),
 *       plus the Stripe-level `succeeded`/`settled` synonyms — read defensively
 *       across `status` | `state` | `payment_status` (no schema change, R69).
 *
 *   (b) PROVABLY FIRST — we query for ANY successful payment for this coach
 *       strictly EARLIER than the event row (by `created_at`, tie-break by id),
 *       scoped to `coach_id` + the success status set. ZERO earlier successful
 *       rows ⇒ this is the first successful payment ⇒ celebrate. This kills the
 *       old `count <= 1` ambiguity (lagged/undercount false-fire) AND the
 *       second-payment race (a later row cannot change whether EARLIER
 *       successful rows already exist).
 *
 * FAIL CLOSED: verification error / unknown status / ambiguous result ⇒ no
 * celebration, logged via the shared logger, and the gate is NOT marked seen
 * (a later legitimate event may still verify). When an earlier successful
 * payment is found, we mark seen + close the gate (stop subscribing), no
 * celebration. All on the same authenticated Supabase client — no schema
 * change (R69), no backend change; this is a mobile-only PR.
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
  /** Fired once when the coach's FIRST (gate-unseen) payment INSERT arrives. */
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
  // Else derive from a numeric `amount` (assumed major units) + currency.
  const raw = row.amount;
  const currency =
    typeof row.currency === 'string' && row.currency.length === 3
      ? row.currency.toUpperCase()
      : 'USD';
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
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
 * The success/settled status values a payment row may carry. Sourced from the
 * repo's documented success predicate `status IN ('paid','active')`
 * (ClientPurchase.status, schema.prisma:3214; src/api/clientPaymentsApi.ts:566,
 * 624-626; checkout.service.ts:723-727) plus the Stripe-level synonyms
 * `succeeded` / `settled` / `completed`. The realtime `payments` table is
 * Supabase-native and not modelled in the backend Prisma schema, so the column
 * name is read defensively (status | state | payment_status) — no schema
 * change (R69).
 */
const SUCCESS_STATUSES: readonly string[] = [
  'paid',
  'active',
  'succeeded',
  'settled',
  'completed',
];

/**
 * Read the success disposition of a payment row.
 *   true     → the row carries a recognised success/settled status
 *   false    → the row carries a status, but it is NOT a success status
 *   'absent' → no status-like field present → ambiguous → FAIL CLOSED
 */
function rowSuccessStatus(
  row: Record<string, unknown>,
): boolean | 'absent' {
  const raw = row.status ?? row.state ?? row.payment_status;
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'absent';
  return SUCCESS_STATUSES.includes(raw.trim().toLowerCase());
}

/**
 * Server-authoritative verdict on whether the SUCCESSFUL INSERT we received is
 * the coach's FIRST successful payment. Queries the same authenticated client
 * (no schema change — R69) for successful `payments` rows scoped to this coach,
 * ordered by `created_at` then `id`, and asks whether ANY successful row exists
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
  // earliest first. `limit(2)` is enough: we only need to know whether any row
  // OTHER than the event itself precedes it.
  const { data, error: queryError } = await client
    .from('payments')
    .select('id, created_at, status')
    .eq('coach_id', coachId)
    .in('status', SUCCESS_STATUSES as string[])
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

        channel = client
          .channel(`ed3-first-payment-${coachId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'payments',
              filter: `coach_id=eq.${coachId}`,
            },
            (payload) => {
              // Re-check the gate at fire time, THEN prove server-side that
              // this is genuinely the coach's FIRST SUCCESSFUL payment before
              // celebrating. Every guard fails closed (Law #36): a payment
              // after the gate is closed, a non-success INSERT, an established
              // coach, or a verification error must NOT spend the one
              // sanctioned exclamation.
              hasSeenFirstPayment(coachId as string)
                .then(async (already) => {
                  if (already || cancelled || !client) return;
                  const row = (payload.new ?? {}) as Record<string, unknown>;
                  // Guard (a): the inserted row must itself be a successful /
                  // settled payment. A failed / pending / refunded INSERT (or a
                  // row with no status field) is ignored and does NOT mark the
                  // gate seen — a later genuine paid row can still verify.
                  const success = rowSuccessStatus(row);
                  if (success !== true) {
                    logger.log(
                      'ed3',
                      'non-success payment insert ignored; gate left unseen',
                      { disposition: String(success) },
                    );
                    return;
                  }
                  // Guard (b): prove this is the FIRST successful payment.
                  const verdict = await verifyFirstSuccessfulPayment(
                    client,
                    coachId as string,
                    row,
                  );
                  if (cancelled) return;
                  if (verdict === 'established') {
                    // An earlier successful payment exists — this coach is past
                    // their first. Close the local gate so we stop re-arming on
                    // future opens, and never celebrate.
                    logger.log(
                      'ed3',
                      'established coach payment; suppressing celebration and closing gate',
                    );
                    await markFirstPaymentSeen(coachId as string);
                    return;
                  }
                  if (verdict !== 'first') {
                    // 'unknown' — verification could not prove the first success.
                    // FAIL CLOSED: do not celebrate, do not mark seen. Already
                    // logged in helper.
                    return;
                  }
                  cbRef.current({
                    amount: formatAmount(row),
                    clientName: readClientName(row),
                  });
                })
                .catch((err) => {
                  // Gate re-check / verification failed — do not swallow
                  // (Law #36). We skip firing (fail-closed) and record why the
                  // celebration was suppressed on this INSERT.
                  logger.warn('ed3', 'first-payment verification failed', {
                    reason: errorMessage(err, 'verification failed'),
                  });
                });
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
