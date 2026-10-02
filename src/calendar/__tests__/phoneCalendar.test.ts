jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));

import * as Calendar from 'expo-calendar/legacy';
import type { CoachingSession } from '../../api/schedulingApi';
import { addSessionToPhoneCalendar, phoneCalendarResultMessage } from '../phoneCalendar';

const cal = Calendar as jest.Mocked<typeof Calendar>;
const session: CoachingSession = {
  id: 's1', coach_id: 'c1', client_id: 'u1', session_type_id: 't1', status: 'scheduled',
  start_at: '2030-10-05T16:00:00Z', end_at: '2030-10-05T16:15:00Z',
  title: 'Quick initialization', coach_notes_md: null, client_recap_md: null,
  video_provider: 'manual', video_url: 'https://meet.example/room', video_meeting_id: null,
  calendar_provider: 'stub', calendar_event_id: null, approved_at: null, ended_at: null,
  end_reason: null, created_at: '', updated_at: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  cal.isAvailableAsync.mockResolvedValue(true);
  cal.createEventInCalendarAsync.mockResolvedValue({ action: Calendar.CalendarDialogResultActions.saved, id: 'event' });
});

it('opens the OS editor with absolute times, both reminders and no account linking', async () => {
  await expect(addSessionToPhoneCalendar(session, 'Coach')).resolves.toEqual({ kind: 'added' });
  expect(cal.createEventInCalendarAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Quick initialization',
      startDate: new Date(session.start_at),
      endDate: new Date(session.end_at),
      alarms: [{ relativeOffset: -1440 }, { relativeOffset: -60 }],
      url: 'https://meet.example/room',
    }),
    { startNewActivityTask: false },
  );
  expect(cal.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  expect(cal.getCalendarsAsync).not.toHaveBeenCalled();
});

it('does not claim that Android done means saved', async () => {
  cal.createEventInCalendarAsync.mockResolvedValue({ action: Calendar.CalendarDialogResultActions.done, id: null });
  const result = await addSessionToPhoneCalendar(session, 'Coach');
  expect(result).toEqual({ kind: 'opened' });
  expect(phoneCalendarResultMessage(result)).toMatch(/confirm you saved/);
});

it('handles dismissal without claiming a write', async () => {
  cal.createEventInCalendarAsync.mockResolvedValue({ action: Calendar.CalendarDialogResultActions.canceled, id: null });
  const result = await addSessionToPhoneCalendar(session, 'Coach');
  expect(result).toEqual({ kind: 'canceled' });
  expect(phoneCalendarResultMessage(result)).toMatch(/without saving/);
});

it('reports an unavailable calendar with a recovery action', async () => {
  cal.isAvailableAsync.mockResolvedValue(false);
  const result = await addSessionToPhoneCalendar(session, 'Coach');
  expect(result).toEqual({ kind: 'unavailable' });
  expect(phoneCalendarResultMessage(result)).toMatch(/Install or enable/);
  expect(cal.createEventInCalendarAsync).not.toHaveBeenCalled();
});

it.each(['requested', 'canceled', 'pending_provider'] as const)('never copies a %s session', async (status) => {
  expect((await addSessionToPhoneCalendar({ ...session, status }, 'Coach')).kind).toBe('error');
  expect(cal.createEventInCalendarAsync).not.toHaveBeenCalled();
});

it('rejects malformed dates and preserves TGP booking after a native error', async () => {
  expect((await addSessionToPhoneCalendar({ ...session, start_at: 'bad' }, 'Coach')).kind).toBe('error');
  cal.createEventInCalendarAsync.mockRejectedValue(new Error('native failure'));
  const result = await addSessionToPhoneCalendar(session, 'Coach');
  expect(result.kind).toBe('error');
  expect(phoneCalendarResultMessage(result)).toMatch(/reference CAL-/);
});

it('serializes native editor presentation on rapid taps', async () => {
  let finish: (value: Calendar.DialogEventResult) => void = () => undefined;
  cal.createEventInCalendarAsync.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = addSessionToPhoneCalendar(session, 'Coach');
  await Promise.resolve();
  expect(await addSessionToPhoneCalendar(session, 'Coach')).toEqual({ kind: 'opened' });
  finish({ action: Calendar.CalendarDialogResultActions.saved, id: 'event' });
  await first;
  expect(cal.createEventInCalendarAsync).toHaveBeenCalledTimes(1);
});

// S-SCHED-3 C-325-6 and B-325-1: neutral description; phone calls keep the number.
function editorEvent(i: number) {
  const event = cal.createEventInCalendarAsync.mock.calls[i]?.[0];
  if (!event) throw new Error(`the calendar editor was not opened (call ${i})`);
  return event;
}
it('describes the copy with the appointment type, or "Coaching session"', async () => {
  await addSessionToPhoneCalendar({ ...session, session_type: { id: 't1', name: 'Quick initialization', duration_minutes: 15, auto_approve: true, is_welcome: true, archived: false } }, 'Coach');
  expect(editorEvent(0).notes).toMatch(/^Quick initialization with Coach\./);
  await addSessionToPhoneCalendar(session, 'Coach');
  const notes = String(editorEvent(1).notes);
  expect(notes).toMatch(/^Coaching session with Coach\./);
  expect(notes).not.toMatch(/Personal-training/);
});

it('a phone-call session keeps the number in the copy and links it', async () => {
  await addSessionToPhoneCalendar({ ...session, video_url: 'tel:+1 425 555 0100' }, 'Coach');
  const event = editorEvent(0);
  expect(event.notes).toContain('Phone call: +1 425 555 0100');
  expect(event.notes).not.toContain('Join:');
  expect(event.url).toBe('tel:+14255550100');
});

it('an unsafe link never reaches the calendar copy', async () => {
  await addSessionToPhoneCalendar({ ...session, video_url: 'javascript:alert(1)' }, 'Coach');
  const event = editorEvent(0);
  expect(event.url).toBeUndefined();
  expect(event.notes).not.toContain('javascript');
});
