/**
 * Trust & Privacy, "Who can see your data": the coach line and the Roman line
 * follow the account's real coach link and its Coach sharing switches
 * (FW-ACCOUNT-128 U2 and FW-COACH). What the copy rests on (backend main):
 * - the coach reads consultation answers on the coach link alone
 *   (onboarding.service.ts canCoachRead), not through the switches;
 * - the coach reads connected-device data (Apple Health, Health Connect) on
 *   the coach link alone (coachSharingCopy.devicesNote);
 * - workouts, food logs, weigh-ins, check-ins and habits only while their
 *   switch is on, except a coach on the TGP owner account (owner_access),
 *   which sees them even when they are off.
 * Nothing is said about a coach the account does not have.
 */
import { COACH_SHARING_LABELS, COACH_SHARING_SCOPES } from '../api/coachSharingApi';
import type { CoachSharingState } from '../api/coachSharingApi';

export type TrustCoachView =
  /** The account or its switches are still loading. */
  | { kind: 'checking' }
  /** A coach account, or a client with no coach. */
  | { kind: 'no_coach' }
  /** A client with a coach; the switches loaded. */
  | { kind: 'read'; state: CoachSharingState }
  /** A client with a coach; the switches did not load. */
  | { kind: 'unread' };

const SEEN_WITHOUT_SWITCHES = 'your consultation answers, data from connected devices';
const OWNER_IF =
  'If your coach uses the TGP owner account, that account sees your logs even when they are turned off in Coach sharing.';

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
  if (view.kind === 'unread') {
    return sentences([`Your coach — ${SEEN_WITHOUT_SWITCHES}, and the logs you share in Coach sharing`, OWNER_IF]);
  }
  const { state } = view;
  if (state.ownerAccess === true) {
    return sentences([
      `Your coach — ${SEEN_WITHOUT_SWITCHES}, and your workouts, food logs, weigh-ins, check-ins and habits`,
      'Your coach uses the TGP owner account, which sees these logs even when they are turned off in Coach sharing',
    ]);
  }
  const logs = sharedLogs(state);
  const parts = logs
    ? [`Your coach — ${SEEN_WITHOUT_SWITCHES}, and the logs you share in Coach sharing: ${logs}`]
    : ['Your coach — your consultation answers and data from connected devices', 'Every Coach sharing switch is off, so no logs are shared'];
  return sentences(state.ownerAccess === null ? [...parts, OWNER_IF] : parts);
}

/** Roman conversations: "Not your coach" only when there is a coach. */
export function trustRomanLine(view: TrustCoachView): string {
  return view.kind === 'read' || view.kind === 'unread'
    ? 'Not your coach — your Roman conversations, which are kept until you delete them or your account'
    : 'Your Roman conversations are kept until you delete them or your account';
}
