/**
 * An explicit, user-controlled copy into the device calendar.
 * Uses the OS event editor, not account linking or full-calendar reads.
 * Copies do not auto-sync; TGP remains authoritative for booking status.
 */
import * as Calendar from 'expo-calendar/legacy';
import type { CoachingSession } from '../api/schedulingApi';
import { resolveCallLink } from '../api/schedulingApi';
import { calendarErrorMessage } from './schedulingErrors';

export type AddResult =
  | { kind: 'added' }
  | { kind: 'opened' }
  | { kind: 'canceled' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

let presenting = false;

/**
 * Neutral description for the calendar copy (S-SCHED-3 C-325-6): the
 * appointment type's name, else "Coaching session".
 */
export function sessionKindLabel(session: CoachingSession): string {
  const name = session.session_type?.name?.trim();
  return name ? name : 'Coaching session';
}

export async function addSessionToPhoneCalendar(
  session: CoachingSession,
  coachName: string,
): Promise<AddResult> {
  if (presenting) return { kind: 'opened' };
  if (session.status !== 'scheduled') {
    return { kind: 'error', message: 'Only confirmed sessions can be copied. Open Calendar to check the booking status.' };
  }
  const start = new Date(session.start_at);
  const end = new Date(session.end_at);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return { kind: 'error', message: 'This session has an invalid time. Message your coach before adding it to your calendar.' };
  }
  presenting = true;
  try {
    if (!(await Calendar.isAvailableAsync())) return { kind: 'unavailable' };
    const link = resolveCallLink(session.video_url);
    const result = await Calendar.createEventInCalendarAsync(
      {
        title: session.title || `Session with ${coachName}`,
        startDate: start,
        endDate: end,
        notes: [
          `${sessionKindLabel(session)} with ${coachName}.`,
          ...(link?.kind === 'video' ? [`Join: ${link.url}`] : []),
          ...(link?.kind === 'phone' ? [`Phone call: ${link.display}`] : []),
          'Check The Growth Project for booking status. This calendar copy does not update automatically.',
        ].join('\n'),
        url: link?.url ?? undefined,
        alarms: [{ relativeOffset: -1440 }, { relativeOffset: -60 }],
      },
      { startNewActivityTask: false },
    );
    if (result.action === 'saved') return { kind: 'added' };
    if (result.action === 'canceled' || result.action === 'deleted') return { kind: 'canceled' };
    // Android cannot report whether the user saved or dismissed the editor.
    // Never claim that returning from the native editor proves a write.
    return { kind: 'opened' };
  } catch (err) {
    return { kind: 'error', message: calendarErrorMessage(err, 'open the phone calendar') };
  } finally {
    presenting = false;
  }
}

export function phoneCalendarResultMessage(result: AddResult): string {
  switch (result.kind) {
    case 'added':
      return 'Saved to your phone calendar. If the session changes, update this copy in your calendar app.';
    case 'opened':
      return 'Check your calendar app to confirm you saved the event. Calendar copies do not update automatically.';
    case 'canceled':
      return 'The calendar editor was closed without saving. Tap Add to my calendar to open it again.';
    case 'unavailable':
      return 'No calendar editor is available on this device. Install or enable a calendar app, then tap Add to my calendar.';
    case 'error':
      return result.message;
  }
}
