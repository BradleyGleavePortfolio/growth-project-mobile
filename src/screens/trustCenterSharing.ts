/**
 * Trust & Privacy, "Who can see your data": the coach line and the Roman line
 * follow the account's real coach link (FW-ACCOUNT-128 U2 and FW-COACH). The
 * current coach sees consultation answers, connected-device data and every
 * log (owner #SHARE-SIMPLE / #SHARE-JOIN, backend #1061: no Coach sharing
 * switches), so the line is the same whether or not GET /consent/me loaded.
 * Nothing is said about a coach the account does not have.
 */
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

/** Owner SU-5 B. */
const COACH_LINE =
  'Your coach — everything you log (workouts, food, weigh-ins, check-ins and habits), your consultation answers and data from connected devices';

/** One or more sentences; a single phrase keeps the bullet style (no full stop). */
function sentences(parts: string[]): string {
  return parts.length === 1 ? parts[0] : parts.map((p) => (p.endsWith('.') ? p : `${p}.`)).join(' ');
}

/** The "Your coach" bullet, or null when there is no coach to describe (or it is not known yet). */
export function trustCoachLine(view: TrustCoachView): string | null {
  return view.kind === 'checking' || view.kind === 'no_coach' ? null : COACH_LINE;
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
