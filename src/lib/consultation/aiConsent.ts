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
import {
  isLiveGrant,
  parseUpgrade,
  type AiConsentAsk,
  type AiConsentOutcome,
  type AiConsentStatusResponse,
  type AiConsentUpgradeCopy,
  type GrantRomanConsentRequest,
} from '../../api/aiConsentApi';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_CHECKBOX_LABEL_COACH_FREE,
  AI_CONSENT_COACH_FREE_COPY_SHA256,
  AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_CRISIS_COPY_SHA256,
  AI_CONSENT_CRISIS_MEMORY_COPY_SHA256,
  AI_CONSENT_HEALTH_COPY_SHA256,
  AI_CONSENT_HEALTH_CRISIS_COPY_SHA256,
  AI_CONSENT_HEALTH_CRISIS_MEMORY_COPY_SHA256,
  AI_CONSENT_HEALTH_MEMORY_COPY_SHA256,
  AI_CONSENT_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_PARAGRAPH_COACH_FREE,
  AI_CONSENT_PARAGRAPH_CRISIS,
  AI_CONSENT_PARAGRAPH_HEALTH,
  AI_CONSENT_PARAGRAPH_HEALTH_CRISIS,
  AI_CONSENT_PARAGRAPH_PRE57C,
  AI_CONSENT_PRE57C_COPY_SHA256,
  AI_CONSENT_PRE57C_MEMORY_COPY_SHA256,
} from './copy';
import {
  AI_CONSENT_COACH_FREE_MEMORY_VERSION,
  AI_CONSENT_COACH_FREE_VERSION,
  AI_CONSENT_CRISIS_MEMORY_VERSION,
  AI_CONSENT_CRISIS_VERSION,
  AI_CONSENT_HEALTH_CRISIS_MEMORY_VERSION,
  AI_CONSENT_HEALTH_CRISIS_VERSION,
  AI_CONSENT_HEALTH_MEMORY_VERSION,
  AI_CONSENT_HEALTH_VERSION,
  AI_CONSENT_MEMORY_VERSION,
  AI_CONSENT_PRE57C_MEMORY_VERSION,
  AI_CONSENT_PRE57C_VERSION,
  AI_CONSENT_VERSION,
} from './consentVersion';

/**
 * The box 2 copies a client sees: coached client-ai-v6 / v7 (owner 57c), or v8 / v9 when the server
 * answers with them (CRISIS-APP-COPY, while its crisis switch is on); client-ai-v4 / v5 for a client
 * whose live grant is of them (the server answers with those copies); coach-free
 * (client-ai-v4-coach-free / v5-coach-free, owner 62) only for a grant recorded before owner 62y2.
 * `paragraph` and `boxLabel` are this build's base text; the memory paragraph always comes from the server.
 */
export interface RomanCopyFamily {
  coachFree: boolean;
  baseVersion: string;
  baseSha256: string;
  memoryVersion: string;
  memorySha256: string;
  paragraph: string;
  boxLabel: string;
}

const COACHED_FAMILY: RomanCopyFamily = {
  coachFree: false,
  baseVersion: AI_CONSENT_VERSION,
  baseSha256: AI_CONSENT_COPY_SHA256,
  memoryVersion: AI_CONSENT_MEMORY_VERSION,
  memorySha256: AI_CONSENT_MEMORY_COPY_SHA256,
  paragraph: AI_CONSENT_PARAGRAPH,
  boxLabel: AI_CONSENT_CHECKBOX_LABEL,
};

const CRISIS_FAMILY: RomanCopyFamily = {
  coachFree: false,
  baseVersion: AI_CONSENT_CRISIS_VERSION,
  baseSha256: AI_CONSENT_CRISIS_COPY_SHA256,
  memoryVersion: AI_CONSENT_CRISIS_MEMORY_VERSION,
  memorySha256: AI_CONSENT_CRISIS_MEMORY_COPY_SHA256,
  paragraph: AI_CONSENT_PARAGRAPH_CRISIS,
  boxLabel: AI_CONSENT_CHECKBOX_LABEL,
};

/** CONSENT-M (b#1117): the Health-notes copies, client-ai-v12 / v10 and, with the crisis sentence, v13 / v11. */
const HEALTH_FAMILY: RomanCopyFamily = {
  coachFree: false,
  baseVersion: AI_CONSENT_HEALTH_VERSION,
  baseSha256: AI_CONSENT_HEALTH_COPY_SHA256,
  memoryVersion: AI_CONSENT_HEALTH_MEMORY_VERSION,
  memorySha256: AI_CONSENT_HEALTH_MEMORY_COPY_SHA256,
  paragraph: AI_CONSENT_PARAGRAPH_HEALTH,
  boxLabel: AI_CONSENT_CHECKBOX_LABEL,
};

const HEALTH_CRISIS_FAMILY: RomanCopyFamily = {
  coachFree: false,
  baseVersion: AI_CONSENT_HEALTH_CRISIS_VERSION,
  baseSha256: AI_CONSENT_HEALTH_CRISIS_COPY_SHA256,
  memoryVersion: AI_CONSENT_HEALTH_CRISIS_MEMORY_VERSION,
  memorySha256: AI_CONSENT_HEALTH_CRISIS_MEMORY_COPY_SHA256,
  paragraph: AI_CONSENT_PARAGRAPH_HEALTH_CRISIS,
  boxLabel: AI_CONSENT_CHECKBOX_LABEL,
};

const PRE57C_FAMILY: RomanCopyFamily = {
  coachFree: false,
  baseVersion: AI_CONSENT_PRE57C_VERSION,
  baseSha256: AI_CONSENT_PRE57C_COPY_SHA256,
  memoryVersion: AI_CONSENT_PRE57C_MEMORY_VERSION,
  memorySha256: AI_CONSENT_PRE57C_MEMORY_COPY_SHA256,
  paragraph: AI_CONSENT_PARAGRAPH_PRE57C,
  boxLabel: AI_CONSENT_CHECKBOX_LABEL,
};

const COACH_FREE_FAMILY: RomanCopyFamily = {
  coachFree: true,
  baseVersion: AI_CONSENT_COACH_FREE_VERSION,
  baseSha256: AI_CONSENT_COACH_FREE_COPY_SHA256,
  memoryVersion: AI_CONSENT_COACH_FREE_MEMORY_VERSION,
  memorySha256: AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
  paragraph: AI_CONSENT_PARAGRAPH_COACH_FREE,
  boxLabel: AI_CONSENT_CHECKBOX_LABEL_COACH_FREE,
};

/** The copies for a client with (false) or without (true) a coach; coached with `crisis`: v8 / v9; `health`: v12 / v10 (v13 / v11). */
export function romanFamily(coachFree: boolean | null | undefined, crisis = false, health = false): RomanCopyFamily {
  if (coachFree) return COACH_FREE_FAMILY;
  if (health) return crisis ? HEALTH_CRISIS_FAMILY : HEALTH_FAMILY;
  return crisis ? CRISIS_FAMILY : COACHED_FAMILY;
}

/** The copies the server answered with, by its current version (coached v6 / v7 unless it names another). */
export function romanFamilyOf(status: AiConsentStatusResponse | null | undefined): RomanCopyFamily {
  const v = status?.current_version;
  if (v === AI_CONSENT_CRISIS_VERSION || v === AI_CONSENT_CRISIS_MEMORY_VERSION) return CRISIS_FAMILY;
  if (v === AI_CONSENT_HEALTH_VERSION || v === AI_CONSENT_HEALTH_MEMORY_VERSION) return HEALTH_FAMILY;
  if (v === AI_CONSENT_HEALTH_CRISIS_VERSION || v === AI_CONSENT_HEALTH_CRISIS_MEMORY_VERSION) return HEALTH_CRISIS_FAMILY;
  if (v === AI_CONSENT_PRE57C_VERSION || v === AI_CONSENT_PRE57C_MEMORY_VERSION) return PRE57C_FAMILY;
  return romanFamily(v === AI_CONSENT_COACH_FREE_VERSION || v === AI_CONSENT_COACH_FREE_MEMORY_VERSION);
}

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

/**
 * The exact grant body for the box 2 text on screen: the server's client-ai-v5 copy when it is shown
 * (R11-C2B), otherwise this build's pinned client-ai-v4 text.
 */
export function romanGrantBody(
  memory: AiConsentUpgradeCopy | null = null,
  family: RomanCopyFamily = COACHED_FAMILY,
): GrantRomanConsentRequest {
  if (memory) return { version: memory.version, copy_sha256: memory.sha256, platform: platformTag() };
  return { version: family.baseVersion, copy_sha256: family.baseSha256, platform: platformTag() };
}

/**
 * A live Roman grant of a copy this build knows (base, or memory). With `family`, only that family's
 * copies count (box 2 on P0 shows that family's text); without it, any this build knows.
 */
export function isLiveRomanGrant(status: AiConsentStatusResponse | null | undefined, family?: RomanCopyFamily): boolean {
  return (family ? [family] : [COACHED_FAMILY, CRISIS_FAMILY, HEALTH_FAMILY, HEALTH_CRISIS_FAMILY, PRE57C_FAMILY, COACH_FREE_FAMILY]).some(
    (f) => isLiveGrant(status, f.baseVersion) || isLiveGrant(status, f.memoryVersion),
  );
}

/** CONSENT-SETTINGS: the ask P0 sends first (owner #162-6, b#1117); Settings and the AI help sheet send it too. */
export const ROMAN_HEALTH_ASK: AiConsentAsk = { healthNotes: true };

/** The server served the Health-notes copies: client-ai-v10 to v13 is current, or its memory offer is v10 / v11. */
export function servesHealthNotes(status: AiConsentStatusResponse | null | undefined): boolean {
  const offer = status?.memory_copy ?? status?.upgrade;
  return [HEALTH_FAMILY, HEALTH_CRISIS_FAMILY].some((f) => romanFamilyOf(status) === f || offer?.version === f.memoryVersion);
}

/**
 * CONSENT-SETTINGS (P0's fallback, m#843): GET the Health-notes copies; when the server did not serve them (one
 * before b#1117 answers with client-ai-v4; a live v4 to v9 grant with no v10 / v11 offer names none), GET `today`
 * and keep today's words. Returns the answer and the ask each later POST / DELETE sends, so its answer reads like
 * this GET's (b#1047). A client with no coach asks coach_free only: there is no coach-free Health-notes copy.
 */
export async function readRomanConsent(
  get: (ask: AiConsentAsk) => Promise<AiConsentOutcome>,
  today: AiConsentAsk,
  stale: () => boolean,
): Promise<{ out: AiConsentOutcome; ask: AiConsentAsk }> {
  if (!today.coachFree) {
    const out = await get(ROMAN_HEALTH_ASK);
    if (stale() || out.kind !== 'ok' || !out.status || servesHealthNotes(out.status)) return { out, ask: ROMAN_HEALTH_ASK };
  }
  return { out: await get(today), ask: today };
}

/**
 * FIX-850-R1 B1: the copies a new agreement (Allow, memory on, memory off) is made in: the ones the server served for
 * `ask` (its memory offer, else its current copies), within the copies that ask names (Health-notes v12 / v10 or
 * v13 / v11; crisis_alert v8 / v9 or v6 / v7; else v6 / v7). Never rebuilt from the phone's crisis flag, which only
 * picks when the answer names none of them. A live grant's copies are its own (B-A, b#1047), so outside the
 * Health-notes ask they name nothing new.
 */
export function offeredFamilyOf(status: AiConsentStatusResponse | null | undefined, ask: AiConsentAsk): RomanCopyFamily {
  const fallback = romanFamily(ask.coachFree, !!ask.crisis, !!ask.healthNotes);
  if (!status || ask.coachFree) return fallback;
  const named = ask.healthNotes ? [HEALTH_CRISIS_FAMILY, HEALTH_FAMILY] : ask.crisis ? [CRISIS_FAMILY, COACHED_FAMILY] : [COACHED_FAMILY];
  const offer = (status.memory_copy ?? status.upgrade)?.version;
  const own = !status.granted || ask.healthNotes ? named.find((f) => f === romanFamilyOf(status)) : undefined;
  return named.find((f) => f.memoryVersion === offer) ?? own ?? fallback;
}

/** A well-formed memory copy of `family` with its pinned sha256 and this build's box 2 label, else null. */
export function pinnedMemoryCopy(copy: unknown, family: RomanCopyFamily = COACHED_FAMILY): AiConsentUpgradeCopy | null {
  const c = parseUpgrade(copy);
  return c &&
    c.version === family.memoryVersion &&
    c.sha256 === family.memorySha256 &&
    c.box_label.text === family.boxLabel
    ? c
    : null;
}

/**
 * R11-C2B (owner 10-07 10:18, Roman memory on by default): the client-ai-v5 copy box 2 shows, and its
 * one tick grants, or null for today's pinned v4 text. A live v5 holder sees the v5 text they allowed;
 * a live v4 holder sees the v4 text they allowed (they get v5 the next time they accept); anyone else
 * sees the server's `memory_copy` while it says Roman memory is on. The current production server
 * sends no `memory_copy`, so this is null there.
 */
export function romanBox2MemoryCopyOf(
  status: AiConsentStatusResponse | null | undefined,
  family: RomanCopyFamily = COACHED_FAMILY,
): AiConsentUpgradeCopy | null {
  if (!status) return null;
  if (isLiveGrant(status, family.memoryVersion)) return pinnedMemoryCopy(status.copy, family);
  if (status.memory_on !== true || isLiveGrant(status, family.baseVersion)) return null;
  return pinnedMemoryCopy(status.memory_copy, family);
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
  /** The body for the text on screen at each attempt (R11-C2B: v5 while box 2 shows it). */
  body: () => GrantRomanConsentRequest = () => romanGrantBody(),
): Promise<RomanGrantResult> {
  let ambiguous = false;
  const settle = (r: RomanGrantResult): RomanGrantResult => (ambiguous ? 'unconfirmed' : r);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!canContinue()) return settle('failed');
    let out: AiConsentOutcome;
    try {
      out = await grant(body());
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
