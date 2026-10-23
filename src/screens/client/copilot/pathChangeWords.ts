/**
 * Path Copilot words (style A board, planning/MOCKUP3/COPILOT/index.md ids in comments) and the lines the phone
 * composes from a structured change. The server sends no titles: "Move {workout}" and every before / after value
 * are written here from the change itself, so the client and the coach always read the same fact.
 */
import { calendarDateInZone, formatTime } from '../../../calendar/calendarTime';
import { resolveClientTimezone } from '../../../api/schedulingApi';
import type { CopilotSuggestion, PathChange } from '../../../api/copilotApi';

export const COPILOT_COPY = {
  title: 'Your path', // CP-A-01
  back: 'You',
  suggested: 'Suggested change', // CP-A-18
  notApplied: 'Not applied yet', // CP-A-19
  now: 'Now', // CP-A-20
  next: 'Suggested', // CP-A-20
  nothingYet: (coach: string) => `Nothing changes until ${coach} says yes.`, // CP-A-21
  privacy: (coach: string) => `${cap(coach)} sees this change and Roman's reason, not your conversation.`, // CP-A-22
  send: (coach: string) => `Send to ${coach}`, // CP-A-23
  notNow: 'Not now', // CP-A-24
  sent: (coach: string, when: string) => `Sent to ${coach} · ${when}`, // CP-A-25
  suggestions: 'Suggestions', // CP-A-26
  waiting: 'Awaiting coach approval', // CP-A-27
  approved: 'Approved by your coach', // CP-A-27
  sentToday: (time: string) => `Sent today, ${time}`, // CP-A-28
  sentOn: (day: string) => `Sent ${day}`,
  declined: (coach: string) => `${cap(coach)} kept your plan as it is`, // CP-A-29
  expired: 'This suggestion has expired.', // CP-BE-07 words
  yourCoach: 'your coach',
  yourClient: 'Your client',
  // Coach card (CP-A-32..36).
  askedBy: (first: string, when: string) => `Asked by ${first} · ${when}`,
  reason: "Roman's reason:",
  drafted: 'Drafted by Roman',
  approve: 'Approve',
  edit: 'Edit',
  decline: 'Decline',
  cancel: 'Cancel',
  notePlaceholder: (first: string) => `Add a note for ${first} (optional)`,
  earlier: 'Earlier day',
  later: 'Later day',
  newTarget: 'New calorie target',
  failed: 'That did not go through. Try again.',
} as const;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const tz = () => resolveClientTimezone();

/** "Thu 22 Oct" in the client's zone (as the board draws it). */
export function shortDay(at: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(at))
    .replace(',', '');
}

const isToday = (at: string, now: Date) => calendarDateInZone(new Date(at), tz()) === calendarDateInZone(now, tz());

/** "Today, 2:34 PM" or "Thu 22 Oct". */
export function when(at: string, now = new Date()): string {
  return isToday(at, now) ? `Today, ${formatTime(new Date(at), tz())}` : shortDay(at);
}

export const kcalText = (n: number) => `${Math.round(n).toLocaleString('en-US')} kcal`;

/** Title, before and after of one change (CP-A-20; the calorie line as the board's queue row draws it). */
export function describeChange(c: PathChange): { title: string; from: string; to: string; summary: string } {
  if (c.kind === 'move_session') {
    const to = shortDay(c.to_at);
    return { title: `Move ${c.workout}`, from: shortDay(c.from_at), to, summary: `Move ${c.workout} to ${to}` };
  }
  const from = kcalText(c.from_kcal);
  return {
    title: 'Calorie target',
    from,
    to: kcalText(c.to_kcal),
    summary: `Calorie target ${Math.round(c.from_kcal).toLocaleString('en-US')} to ${kcalText(c.to_kcal)}`,
  };
}

export type StatusTone = 'waiting' | 'approved' | 'still';

/**
 * The status line of one sent suggestion. Edited ones read as approved, with the change the coach applied. A decline
 * names no coach: the server does not say who decided (#1120 SuggestionView), and after a move the current coach is
 * not the one who declined, so it reads "Your coach kept your plan as it is" (CP-A-29, neutral form).
 */
export function statusLine(s: CopilotSuggestion, _coach: string, now = new Date()): { line: string; meta: string; tone: StatusTone } {
  const sent = s.sent_at ? (isToday(s.sent_at, now) ? COPILOT_COPY.sentToday(formatTime(new Date(s.sent_at), tz())) : COPILOT_COPY.sentOn(shortDay(s.sent_at))) : '';
  const decided = s.decided_at ? shortDay(s.decided_at) : sent;
  if (s.status === 'approved') return { line: COPILOT_COPY.approved, meta: decided, tone: 'approved' };
  if (s.status === 'rejected') return { line: COPILOT_COPY.declined(COPILOT_COPY.yourCoach), meta: decided, tone: 'still' };
  if (s.status === 'expired') return { line: COPILOT_COPY.expired, meta: sent, tone: 'still' };
  return { line: COPILOT_COPY.waiting, meta: sent, tone: 'waiting' };
}
