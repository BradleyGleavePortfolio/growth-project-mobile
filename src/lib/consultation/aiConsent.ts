/**
 * Box 2 of the P0 agreement (D2): the optional Roman and AI grant, recorded
 * by the AI consent ledger (R2a) and never by the intake.
 *
 * Non-blocking by contract: a failure never blocks onboarding, plan
 * assignment, coach messaging, community, wearables, the scripted Roman
 * tutorial, the welcome message or reminders. A failed call is retried once
 * and otherwise left for Settings > Privacy > Roman and AI. While the ledger
 * is not deployed (404) or switched off (503) the call is skipped silently.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AiConsentOutcome, GrantRomanConsentRequest } from '../../api/aiConsentApi';
import { AI_CONSENT_COPY_SHA256 } from './copy';
import { AI_CONSENT_VERSION } from './consentVersion';

/**
 * - `granted`: the ledger confirmed the grant.
 * - `unavailable`, `version_mismatch`, `failed`: the server refused every
 *   attempt in a way that means nothing was written (404 / 503, 409
 *   CONSENT_VERSION_MISMATCH, or a 4xx such as 400 / 401 / 403 / 429), or
 *   nothing was sent at all.
 * - `unconfirmed` (Sol B-310-5): at least one POST was sent and its answer
 *   does not prove it was not written (no response, a timeout, 5xx other than
 *   503, 409 AI_CONSENT_CONFLICT). The grant may be on file; an error is not
 *   evidence that a write never committed.
 */
export type RomanGrantResult = 'granted' | 'unavailable' | 'version_mismatch' | 'failed' | 'unconfirmed';

/**
 * Whether a failed ledger write may still have been committed: no response
 * at all, a timeout, a server error, or a conflict. A 4xx refusal (400, 401,
 * 403, 404, 429) and 503 AI_CONSENT_UNAVAILABLE are answered before anything
 * is written.
 */
export function isAmbiguousWriteOutcome(out: AiConsentOutcome): boolean {
  if (out.kind !== 'error') return false;
  const st = out.status;
  return st === null || st === 408 || st === 409 || st >= 500;
}

export function platformTag(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

/** The exact grant body for the box 2 text this build displays. */
export function romanGrantBody(): GrantRomanConsentRequest {
  return { version: AI_CONSENT_VERSION, copy_sha256: AI_CONSENT_COPY_SHA256, platform: platformTag() };
}

/**
 * POST the box 2 grant (backend #622 error table, operator ruling
 * 2026-10-01): one retry on a transient failure (network, 5xx other than
 * 503, 409 AI_CONSENT_CONFLICT). 404 (ledger not deployed) and 503
 * AI_CONSENT_UNAVAILABLE (switch off) are skipped silently; 400 and 409
 * CONSENT_VERSION_MISMATCH are not retried. Whatever is left goes to Settings.
 *
 * `canContinue` is checked before every attempt, so the retry never goes out
 * once the client has made a newer choice or another user signed in (Sol
 * B-310-5). Once any attempt was sent with an ambiguous answer the result is
 * `unconfirmed` unless a later attempt confirms the grant.
 */
export async function grantRomanWithRetry(
  grant: (body: GrantRomanConsentRequest) => Promise<AiConsentOutcome>,
  /** Checked before each attempt: false stops (a newer choice, or another user signed in). */
  canContinue: () => boolean = () => true,
): Promise<RomanGrantResult> {
  let ambiguous = false;
  const settle = (r: RomanGrantResult): RomanGrantResult => (ambiguous ? 'unconfirmed' : r);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!canContinue()) return settle('failed');
    let out: AiConsentOutcome;
    try {
      out = await grant(romanGrantBody());
    } catch {
      out = { kind: 'error', status: null };
    }
    if (out.kind === 'ok') return 'granted';
    if (out.kind === 'version_mismatch') return settle('version_mismatch');
    if (out.kind === 'unavailable') return settle('unavailable');
    if (isAmbiguousWriteOutcome(out)) ambiguous = true;
    else return settle('failed'); // 400 / 401 / 403 / 429: refused; not retried as-is
  }
  return settle('failed');
}

export type RomanWithdrawResult = 'withdrawn' | 'failed';

/**
 * DELETE the box 2 grant when the client unticks it on a return to P0
 * (Opus B-310-2), or when a grant may have been written without a
 * confirmation (Sol B-310-5; DELETE is idempotent, so withdrawing a grant
 * that never landed is harmless): exactly one retry on anything but a
 * confirmed result, except 400 / 404 (nothing to retry against).
 * Unconfirmed is reported so the flow keeps the withdrawal pending.
 */
export async function withdrawRomanWithRetry(
  withdraw: () => Promise<AiConsentOutcome>,
  /** Checked before each attempt: false stops (e.g. another user signed in). */
  canContinue: () => boolean = () => true,
): Promise<RomanWithdrawResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!canContinue()) return 'failed';
    let out: AiConsentOutcome;
    try {
      out = await withdraw();
    } catch {
      out = { kind: 'error', status: null };
    }
    if (out.kind === 'ok') return 'withdrawn';
    if (out.kind === 'unavailable' && out.status === 404) return 'failed';
    if (out.kind === 'error' && out.status === 400) return 'failed';
  }
  return 'failed';
}

// ── Pending withdrawal (Sol B-310-5) ────────────────────────────────────────
//
// A "no" to box 2 that the ledger has not confirmed outlives the consultation:
// the draft is purged when the client finishes, and the app can be closed at
// any moment. So the wanted withdrawal is also kept under its own per-user
// key until a DELETE is confirmed, and drained when the client app opens
// (useAiWithdrawalDrain) and when Settings > Privacy > Roman and AI opens. A
// newer "yes" (on P0, or in Settings at the grant's own queue turn) clears
// it, so an old "no" can never undo a newer choice. The value holds a
// timestamp only.

const PENDING_PREFIX = 'consultation_ai_withdraw_pending:';

export function aiWithdrawalPendingKey(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

/** Record that this user wants box 2 withdrawn and it is not confirmed yet. Returns the marker. */
export async function markAiWithdrawalPending(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const stamp = new Date().toISOString();
  try {
    await AsyncStorage.setItem(aiWithdrawalPendingKey(userId), stamp);
    return stamp;
  } catch {
    return null;
  }
}

export async function readAiWithdrawalPending(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    return await AsyncStorage.getItem(aiWithdrawalPendingKey(userId));
  } catch {
    return null;
  }
}

/**
 * Clear the pending withdrawal. With `stamp`, only that marker is cleared, so
 * a withdrawal confirmed for an older marker never clears a newer one.
 */
export async function clearAiWithdrawalPending(userId: string | null | undefined, stamp?: string | null): Promise<void> {
  if (!userId) return;
  try {
    if (stamp !== undefined && stamp !== null) {
      const cur = await AsyncStorage.getItem(aiWithdrawalPendingKey(userId));
      if (cur !== stamp) return;
    }
    await AsyncStorage.removeItem(aiWithdrawalPendingKey(userId));
  } catch {
    // A marker that stays only causes one more idempotent DELETE.
  }
}

/**
 * How long a ledger write waits for the one before it. Two attempts at the
 * API timeout (30 s each) fit inside it, so a write that never settles (a
 * hung socket) cannot hold every later choice back for good.
 */
export const AI_LEDGER_WAIT_CAP_MS = 65_000;

let ledgerTail: Promise<void> = Promise.resolve();

/**
 * Every write to the AI consent ledger from this app (P0 box 2, the pending
 * withdrawal drain, Settings) runs one at a time, in the order the choices
 * were made, so a request never overtakes an earlier one on the wire.
 */
export function runAiLedgerWrite<T>(fn: () => Promise<T>): Promise<T> {
  const prev = ledgerTail;
  const turn = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, AI_LEDGER_WAIT_CAP_MS);
    const unref = (timer as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(timer);
    void prev.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  const run = turn.then(fn);
  ledgerTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** What a fenced ledger write returns when it never went out. */
export const AI_LEDGER_NOT_SENT = 'not_sent' as const;
export type AiLedgerNotSent = typeof AI_LEDGER_NOT_SENT;

/**
 * A ledger write the client chose as `userId`, fenced by identity (Sol
 * B-310-7). It waits its turn in the one queue, and right before dispatch,
 * and again after any await, checks that `userId` is still the signed-in
 * user. If not (signed out, or another account signed in while it waited),
 * nothing is sent under the other session and AI_LEDGER_NOT_SENT returns.
 */
export function runAiLedgerWriteAs<T>(
  userId: string | null | undefined,
  sessionUserId: () => string | null,
  fn: (stillSameUser: () => boolean) => Promise<T>,
): Promise<T | AiLedgerNotSent> {
  if (!userId) return Promise.resolve(AI_LEDGER_NOT_SENT);
  const same = () => sessionUserId() === userId;
  return runAiLedgerWrite(async () => (same() ? fn(same) : AI_LEDGER_NOT_SENT));
}

/**
 * An explicit "yes" to box 2 from Settings or the AI help sheet (#326),
 * through the one queue and the identity fence. At this write's own turn
 * (after every write queued before it, so an older drain has already run)
 * it clears this user's pending withdrawal, so that older "no" can never
 * undo the newer "yes" (B-326-2), and then sends the grant. Another
 * account's marker is never touched. If the user changed before the turn,
 * nothing is cleared or sent: the older "no" stays wanted, which keeps AI
 * off rather than on.
 */
export function grantAiChoiceAs(
  userId: string | null | undefined,
  sessionUserId: () => string | null,
  grant: () => Promise<AiConsentOutcome>,
): Promise<AiConsentOutcome | AiLedgerNotSent> {
  return runAiLedgerWriteAs(userId, sessionUserId, async (same) => {
    await clearAiWithdrawalPending(userId);
    if (!same()) return AI_LEDGER_NOT_SENT;
    return grant();
  });
}

/**
 * An explicit "no" to box 2 from Settings, through the one queue and the
 * identity fence. A confirmed DELETE clears this user's pending withdrawal.
 */
export function withdrawAiChoiceAs(
  userId: string | null | undefined,
  sessionUserId: () => string | null,
  withdraw: () => Promise<AiConsentOutcome>,
): Promise<AiConsentOutcome | AiLedgerNotSent> {
  return runAiLedgerWriteAs(userId, sessionUserId, async () => {
    const out = await withdraw();
    if (out.kind === 'ok') await clearAiWithdrawalPending(userId);
    return out;
  });
}

let markerTail: Promise<void> = Promise.resolve();

/**
 * B-310-8: the onboarding flow's pending-withdrawal marker steps (write,
 * clear, compare-and-clear, the load read) run one at a time, in the order
 * the client's choices were made, so a slow storage write for an older
 * choice can never land after, or be cleared by, a newer one. Each step
 * checks at its turn whether its choice is still the latest. Never nest a
 * call to this inside a step (it would wait for itself).
 */
export function runAiMarkerStep<T>(step: () => Promise<T>): Promise<T> {
  const run = markerTail.then(step, step);
  markerTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Tests only: a fresh queue, as after an app restart (module state is per process). */
export function resetAiLedgerWritesForTests(): void {
  ledgerTail = Promise.resolve();
  markerTail = Promise.resolve();
}

export type AiWithdrawalDrainResult = 'none' | 'withdrawn' | 'failed';

/**
 * Send the pending withdrawal for `userId`, if there is one, behind any
 * ledger write already queued. The marker is read again once it is this
 * write's turn (a newer grant may have cleared it) and cleared only after a
 * confirmed DELETE.
 */
export function drainAiWithdrawal(
  userId: string | null | undefined,
  withdraw: () => Promise<AiConsentOutcome>,
  /** Checked before each attempt: false stops (another user signed in). */
  canContinue: () => boolean = () => true,
): Promise<AiWithdrawalDrainResult> {
  if (!userId) return Promise.resolve('none');
  return runAiLedgerWrite(async () => {
    const stamp = await readAiWithdrawalPending(userId);
    if (!stamp) return 'none';
    const result = await withdrawRomanWithRetry(withdraw, canContinue);
    if (result !== 'withdrawn') return 'failed';
    await clearAiWithdrawalPending(userId, stamp);
    return 'withdrawn';
  });
}
