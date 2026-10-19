/**
 * B-PACKAGE-135 — every coach code or link carries exactly one package
 * (backend b#902). The attach routes answer `join` (attach-invite-code,
 * coachless redeem) or `invite_join` (signup-with-code, google, apple,
 * select-role):
 *   granted            attached with the package now (free, or prepaid to the coach)
 *   checkout_required  NOT attached yet: the client pays in the app with
 *                      `join_code`, and the purchase attaches them
 * Every accept point hands its response to `presentJoinFrom`; JoinPackageHost
 * (mounted with the client tabs) shows JoinPackageScreen. After "Not now",
 * Home shows "Finish joining <coach>" (FinishJoining) until it is paid.
 * Older backends send no join: nothing changes.
 * FIX712: a paid join's package carries the server's `quote` (backend #1002,
 * fresh on every attach call). A saved join never shows its saved quote; the
 * screen re-reads the join when "Finish joining" reopens it (rereadJoin).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { authApi } from '../services/api';
import { logger } from '../utils/logger';
import { patchUserCache } from './userCache';

const KEY = 'pending_join_package.v1';

const JoinSchema = z.object({
  status: z.enum(['granted', 'checkout_required']),
  grant_mode: z.enum(['free', 'prepaid', 'none']),
  package: z
    .object({
      id: z.string().min(1),
      name: z.string(),
      amount_cents: z.number(),
      currency: z.string(),
      billing_type: z.string(),
      interval: z.string().nullable(),
      interval_count: z.number(),
      recurring_amount_cents: z.number().nullable(),
      recurring_interval: z.string().nullable(),
      recurring_interval_count: z.number().nullable(),
      trial_days: z.number(),
      is_free: z.boolean(),
    })
    .passthrough(),
  coach: z.object({ id: z.string().min(1), first_name: z.string() }),
  code: z.string().min(1),
});
export type JoinOutcome = z.infer<typeof JoinSchema>;

type Listener = () => void;
const listeners = new Set<Listener>();
/** A join to show, and whether "Finish joining" reopened it from the saved copy. */
export interface PresentedJoin {
  join: JoinOutcome;
  resumed: boolean;
}
let presented: PresentedJoin | null = null;

export function subscribeJoin(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch (err) {
      logger.warn('JoinPackage', 'listener failed', err);
    }
  }
}

/** The join in an attach response (`invite_join` or `join`), or null (older backend, bad shape). */
export function joinOutcomeOf(data: unknown): JoinOutcome | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { invite_join?: unknown; join?: unknown };
  const parsed = JoinSchema.safeParse(d.invite_join ?? d.join);
  return parsed.success ? parsed.data : null;
}

/**
 * Hands an accept point's response to the package screen. A paid join is
 * kept until it is paid; a granted one is shown once (never on a replay of a
 * join that already happened). True when the response carried a join.
 */
export function presentJoinFrom(data: unknown): boolean {
  const join = joinOutcomeOf(data);
  if (!join) return false;
  const replay = (data as { already_attached?: unknown }).already_attached === true;
  if (join.status === 'checkout_required') {
    keepPendingJoin(join);
  } else {
    void clearPendingJoin();
  }
  if (join.status === 'checkout_required' || !replay) showJoin(join);
  return true;
}

function keepPendingJoin(join: JoinOutcome): void {
  void AsyncStorage.setItem(KEY, JSON.stringify(join))
    .catch((err: unknown) => logger.warn('JoinPackage', 'pending join save failed', err))
    .then(notify);
}

/**
 * Opens the package screen for this join (JoinPackageHost, mounted with the
 * client tabs). `resumed`: the saved join, reopened by "Finish joining".
 */
export function showJoin(join: JoinOutcome, resumed = false): void {
  presented = { join, resumed };
  notify();
}

/** The join to show now (read once). */
export function takePresentedJoin(): PresentedJoin | null {
  const join = presented;
  presented = null;
  return join;
}

export async function readPendingJoin(): Promise<JoinOutcome | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JoinSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    // The saved quote may be days old: never shown (the screen re-reads it).
    const { quote: _stale, ...pkg } = parsed.data.package;
    return { ...parsed.data, package: pkg };
  } catch (err) {
    logger.warn('JoinPackage', 'pending join read failed', err);
    return null;
  }
}

/**
 * FIX712 — re-reads a saved join from the server: POST /auth/attach-invite-code
 * with its code. For a paid join that call writes nothing (no attach, seat or
 * ledger row) and answers the join with today's quote. If the coach has since
 * made the code free or prepaid, it attaches the client and answers `granted`:
 * a finished join (no payment). Never the coachless redeem, which writes a
 * ledger and an audit row on every call. Null when the call fails or carries no
 * join: the saved join is then shown without a quote.
 */
export async function rereadJoin(saved: JoinOutcome): Promise<JoinOutcome | null> {
  try {
    const res = await authApi.attachInviteCode(saved.code);
    const coachId = (res?.data as { coach_id?: unknown } | undefined)?.coach_id;
    if (typeof coachId === 'string' && coachId) {
      await patchUserCache({ coach_id: coachId }).catch((err: unknown) =>
        logger.warn('JoinPackage', 'user cache patch after re-read failed', err),
      );
    }
    const join = joinOutcomeOf(res?.data);
    if (join?.status === 'checkout_required') keepPendingJoin(join);
    else if (join) await clearPendingJoin();
    return join;
  } catch (err) {
    logger.warn('JoinPackage', 'pending join re-read failed', err);
    return null;
  }
}

export async function clearPendingJoin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (err) {
    logger.warn('JoinPackage', 'pending join clear failed', err);
  }
  notify();
}

/** The coach's first name for copy; "the coach" when the coach has no name on file. */
export function coachNameOf(join: JoinOutcome): string {
  return join.coach.first_name.trim() || 'the coach';
}
