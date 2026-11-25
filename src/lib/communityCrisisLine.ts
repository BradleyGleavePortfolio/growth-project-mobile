/**
 * CRISIS-TEXT-M (owner #200-S1 op 1: "on a match the poster sees the approved 911/988 line; the message still posts";
 * #203-E21). When the server's crisis check matched a member's own community text, the answer to that member's write
 * carries `crisis_flag: true` at its top level, and so does the 422 of a refused text that matched (backend b#1232,
 * CONTRACT 6755386095: present only on a match, never false, never null). This file is the only place that reads it:
 * never the text, a GET, a list, a realtime event or a push. The line shows once per answer, only to the account that
 * sent the write, and the flag is kept nowhere (no cache, mutation result, store, draft, log, report or event).
 *   - crisisFlagIn, the one reader for answers: each of the five writers of b#1232's routes (communityApi createPost,
 *     addComment and sendDm, communityChallengesApi addComment, communityWinsApi postWin) hands its parsed answer to
 *     showCrisisLineFor where it reads it, then returns today's entity, so a mutation's data keeps today's shape. That
 *     runs once per answer whether or not the screen is still there, and no hook or screen callback raises it again.
 *   - crisisFlagInError, the one reader for error bodies: withCrisisLine puts the line first in a refusal's message,
 *     inside the two refusal describers (describeCommunityFailure, contentRejectedMessage), so the line and the
 *     refusal show in the one alert or notice each screen shows today.
 *   - holdCrisisLine: a screen whose RN Modal is up or closing holds the line until it is gone on iOS (an Alert raised
 *     while a Modal closes can be lost there; SafetyMenu afterClose); Android raises at once, as afterClose does.
 */
import { Alert, Platform } from 'react-native';
import { CRISIS_LINE_911_988 } from '../constants/crisisLines';
import { readUserCacheSync } from './userCache';

/** The account signed in now (null when none). A writer reads it when its write starts. */
export function crisisLineOwner(): string | null {
  return readUserCacheSync()?.id ?? null;
}

/** The one reader for answers: `crisis_flag` exactly true at the answer's top level (false, null, "true", 1: no). */
export function crisisFlagIn(answer: unknown): boolean {
  return typeof answer === 'object' && answer !== null && (answer as { crisis_flag?: unknown }).crisis_flag === true;
}

/** The one reader for error bodies: a 422 whose body carries `crisis_flag` exactly true (follows `.cause`). */
export function crisisFlagInError(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    const e = cur as { response?: { status?: unknown; data?: unknown }; cause?: unknown };
    if (e.response) return e.response.status === 422 && crisisFlagIn(e.response.data);
    cur = e.cause;
  }
  return false;
}

/** A refusal's message with the line first and a blank line, as communityReportSentMessage orders it; else unchanged. */
export function withCrisisLine(message: string, err: unknown): string {
  return crisisFlagInError(err) ? `${CRISIS_LINE_911_988}\n\n${message}` : message;
}

/** Whether a notice withCrisisLine built leads with the line (so it can be spoken whole); never reads member text. */
export function leadsWithCrisisLine(message: string | null | undefined): boolean {
  return !!message && message.startsWith(`${CRISIS_LINE_911_988}\n\n`);
}

let holds = 0;
let waiting: string | null = null; // the account whose line waits for a sheet to go (in memory, for that moment only)

function raise(owner: string | null): void {
  if (owner === null || crisisLineOwner() !== owner) return; // signed out, or another account, since the write began
  Alert.alert('', CRISIS_LINE_911_988); // no title (no new words); the system OK button, as "Report sent" does
}

/** Show the line once when `answer` carries the flag and `owner` is still the account signed in. */
export function showCrisisLineFor(answer: unknown, owner: string | null): void {
  if (!crisisFlagIn(answer)) return;
  if (holds > 0) waiting = owner;
  else raise(owner);
}

/** Hold the line while a sheet is up or closing (iOS only); the release shows one that waited. A second release is a no-op. */
export function holdCrisisLine(): () => void {
  if (Platform.OS !== 'ios') return () => undefined;
  holds += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds -= 1;
    if (holds > 0 || waiting === null) return;
    const owner = waiting;
    waiting = null;
    raise(owner);
  };
}
