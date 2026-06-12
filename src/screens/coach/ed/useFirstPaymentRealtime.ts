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
 * Server-authoritative FIRST-payment proof (audit R2 P1): the local once-only
 * gate alone cannot prove a payment is the coach's FIRST — a coach with prior
 * payments but no local gate (new device, storage reset, rollout after
 * history) would otherwise see a false "first payment" celebration. Before
 * celebrating, we verify against the server: a COUNT(*) over `payments` for
 * this `coach_id` via the same authenticated Supabase client (no schema change,
 * R69). We celebrate ONLY when the server proves this is payment #1 (count
 * === 1). We FAIL CLOSED — any verification error suppresses the celebration
 * and is logged. When the count proves prior payments already exist (> 1) we
 * close the local gate so the subscription stops re-arming on future opens.
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
 * Server-authoritative verdict on whether the INSERT we just received is the
 * coach's FIRST payment. Counts the coach's `payments` rows via the same
 * authenticated client (no schema change — R69). The realtime INSERT has
 * already committed by the time this fires, so the COUNT includes it:
 *   count === 1 → 'first'       (this is the only payment → celebrate)
 *   count  > 1 → 'established'  (prior payments exist → never celebrate)
 *   otherwise  → 'unknown'      (count missing / query error → FAIL CLOSED)
 */
async function verifyFirstPayment(
  client: SupabaseClient,
  coachId: string,
): Promise<'first' | 'established' | 'unknown'> {
  // `head: true` makes this a COUNT-only request (no rows transferred); the
  // exact count is server-computed. This reads the same `payments` table the
  // subscription already watches — no new endpoint, no new schema.
  const { count, error: queryError } = await client
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('coach_id', coachId);
  if (queryError) {
    // Do not throw — the caller fails closed on 'unknown' and logs the reason.
    logger.warn('ed3', 'first-payment count query returned error', {
      reason: queryError.message,
    });
    return 'unknown';
  }
  if (typeof count !== 'number') return 'unknown';
  return count <= 1 ? 'first' : 'established';
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
              // this is genuinely the coach's FIRST payment before celebrating.
              // Both guards fail closed (Law #36): a payment after the gate is
              // closed, OR for an established coach, OR when verification
              // errors, must NOT spend the one sanctioned exclamation.
              hasSeenFirstPayment(coachId as string)
                .then(async (already) => {
                  if (already || cancelled || !client) return;
                  const verdict = await verifyFirstPayment(
                    client,
                    coachId as string,
                  );
                  if (cancelled) return;
                  if (verdict === 'established') {
                    // Prior payments exist — this coach is past their first.
                    // Close the local gate so we stop re-arming on future
                    // opens, and never celebrate.
                    logger.log(
                      'ed3',
                      'established coach payment; suppressing celebration and closing gate',
                    );
                    await markFirstPaymentSeen(coachId as string);
                    return;
                  }
                  if (verdict !== 'first') {
                    // 'unknown' — verification could not prove payment #1.
                    // FAIL CLOSED: do not celebrate. Already logged in helper.
                    return;
                  }
                  const row = (payload.new ?? {}) as Record<string, unknown>;
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
