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
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { logger } from '../utils/logger';

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
let presented: JoinOutcome | null = null;

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
    void AsyncStorage.setItem(KEY, JSON.stringify(join))
      .catch((err: unknown) => logger.warn('JoinPackage', 'pending join save failed', err))
      .then(notify);
  } else {
    void clearPendingJoin();
  }
  if (join.status === 'checkout_required' || !replay) showJoin(join);
  return true;
}

/** Opens the package screen for this join (JoinPackageHost, mounted with the client tabs). */
export function showJoin(join: JoinOutcome): void {
  presented = join;
  notify();
}

/** The join to show now (read once). */
export function takePresentedJoin(): JoinOutcome | null {
  const join = presented;
  presented = null;
  return join;
}

export async function readPendingJoin(): Promise<JoinOutcome | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JoinSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    logger.warn('JoinPackage', 'pending join read failed', err);
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
