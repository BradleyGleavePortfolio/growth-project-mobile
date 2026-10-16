/**
 * Trust & Privacy, "Who can see your data": the coach line and the Roman line
 * follow the account's real coach link and what GET /consent/me says that
 * coach can read (FW-ACCOUNT-128 U2 and FW-COACH). What the copy rests on:
 * - the coach reads consultation answers on the coach link alone
 *   (onboarding.service.ts canCoachRead);
 * - the coach reads connected-device data (Apple Health, Health Connect) on
 *   the coach link alone, except weight and body fat, which follow Weigh-ins
 *   (WEIGHTWALL);
 * - workouts, food logs, weigh-ins, check-ins and habits always reach the
 *   current coach with backend #1061 (owner #SHARE-SIMPLE, no switches); an
 *   older backend still withholds a log the client turned off, so a partial
 *   read names only the logs it reports (coachSharingApi.ts folds in the TGP
 *   owner account, which reads them all). A failed read names none.
 * Nothing is said about a coach the account does not have.
 */
import { COACH_SHARING_LABELS, COACH_SHARING_SCOPES } from '../api/coachSharingApi';
import type { CoachSharingState } from '../api/coachSharingApi';

export type TrustCoachView =
  /** The account is still loading. */
  | { kind: 'checking' }
  /** A coach account, or a client with no coach. */
  | { kind: 'no_coach' }
  /** A client with a coach; GET /consent/me loaded. */
  | { kind: 'read'; state: CoachSharingState }
  /** A client with a coach; GET /consent/me did not load. */
  | { kind: 'unread' };

const SEEN_WITHOUT_SWITCHES = 'your consultation answers, data from connected devices';

/** One or more sentences; a single phrase keeps the bullet style (no full stop). */
function sentences(parts: string[]): string {
  return parts.length === 1 ? parts[0] : parts.map((p) => (p.endsWith('.') ? p : `${p}.`)).join(' ');
}

/** "workouts and food logs"; "food logs, check-ins and habits" (that label already ends in "and habits"). */
function sharedLogs(state: CoachSharingState): string {
  const names = COACH_SHARING_SCOPES.filter((s) => state.shared[s]).map((s) => COACH_SHARING_LABELS[s].toLowerCase());
  if (names.length < 2) return names.join('');
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')}${last.includes(' and ') ? ', ' : ' and '}${last}`;
}

/** The "Your coach" bullet, or null when there is no coach to describe (or it is not known yet). */
export function trustCoachLine(view: TrustCoachView): string | null {
  if (view.kind === 'checking' || view.kind === 'no_coach') return null;
  if (view.kind === 'unread') return `Your coach — ${SEEN_WITHOUT_SWITCHES}, and the logs you share in Coach sharing`;
  const { state } = view;
  if (COACH_SHARING_SCOPES.every((s) => state.shared[s])) {
    return `Your coach — ${SEEN_WITHOUT_SWITCHES}, and your workouts, food logs, weigh-ins, check-ins and habits`;
  }
  const logs = sharedLogs(state);
  return logs
    ? `Your coach — ${SEEN_WITHOUT_SWITCHES}, and the logs you share in Coach sharing: ${logs}`
    : 'Your coach — your consultation answers and data from connected devices';
}

/** Roman conversations: "Not your coach" only when there is a coach. */
export function trustRomanLine(view: TrustCoachView): string {
  return view.kind === 'read' || view.kind === 'unread'
    ? sentences([
        'Not your coach — your Roman conversations, which are kept until you delete them or your account',
        'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.',
      ])
    : 'Your Roman conversations are kept until you delete them or your account';
}
