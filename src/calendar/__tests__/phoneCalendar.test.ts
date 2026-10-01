/**
 * S-SCHED "Add to my calendar": permission only on tap, calm denial, one
 * event per session (second tap updates), moved -> updated, cancelled or
 * declined -> removed, and a hand-deleted event is forgotten quietly.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import type { CoachingSession } from '../../api/schedulingApi';
import {
  addSessionToPhoneCalendar,
  getPhoneEvent,
  removeSessionFromPhoneCalendar,
  syncPhoneCalendar,
} from '../phoneCalendar';

const cal = Calendar as jest.Mocked<typeof Calendar>;

function session(over: Partial<CoachingSession> = {}): CoachingSession {
  return {
    id: 'sess-1',
    coach_id: 'coach-1',
    client_id: 'client-1',
    session_type_id: 'st-1',
    status: 'scheduled',
    start_at: '2026-10-05T16:00:00.000Z',
    end_at: '2026-10-05T16:15:00.000Z',
    title: 'Quick initialization',
    coach_notes_md: null,
    client_recap_md: null,
    video_provider: 'manual',
    video_url: 'https://meet.example/room',
    video_meeting_id: null,
    calendar_provider: 'stub',
    calendar_event_id: null,
    approved_at: null,
    ended_at: null,
    end_reason: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

const granted = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' };
const denied = { granted: false, canAskAgain: false, status: 'denied', expires: 'never' };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  cal.getCalendarPermissionsAsync.mockResolvedValue(granted as never);
  cal.requestCalendarPermissionsAsync.mockResolvedValue(granted as never);
  cal.createEventAsync.mockResolvedValue('evt-1');
});

describe('addSessionToPhoneCalendar', () => {
  it('asks for permission only when not yet granted, then adds one event with a reminder and the join link', async () => {
    cal.getCalendarPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' } as never);
    const r = await addSessionToPhoneCalendar(session(), 'Bradley');
    expect(r).toEqual({ kind: 'added', eventId: 'evt-1' });
    expect(cal.requestCalendarPermissionsAsync).toHaveBeenCalledTimes(1);
    const [calendarId, details] = cal.createEventAsync.mock.calls[0];
    expect(calendarId).toBe('cal-default');
    expect(details?.title).toBe('Quick initialization');
    expect(details?.notes).toContain('https://meet.example/room');
    expect(details?.alarms).toEqual([{ relativeOffset: -60 }]);
    expect(await getPhoneEvent('sess-1')).toEqual({
      eventId: 'evt-1',
      start_at: '2026-10-05T16:00:00.000Z',
      end_at: '2026-10-05T16:15:00.000Z',
    });
  });

  it('a denial returns calmly and never re-prompts when the OS says it cannot ask again', async () => {
    cal.getCalendarPermissionsAsync.mockResolvedValue(denied as never);
    await expect(addSessionToPhoneCalendar(session(), 'Bradley')).resolves.toEqual({ kind: 'denied' });
    expect(cal.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(cal.createEventAsync).not.toHaveBeenCalled();
  });

  it('a second tap updates the same event instead of adding a duplicate', async () => {
    await addSessionToPhoneCalendar(session(), 'Bradley');
    const r = await addSessionToPhoneCalendar(session(), 'Bradley');
    expect(r).toEqual({ kind: 'updated', eventId: 'evt-1' });
    expect(cal.createEventAsync).toHaveBeenCalledTimes(1);
    expect(cal.updateEventAsync).toHaveBeenCalledWith('evt-1', expect.any(Object));
  });

  it('re-adds when the client deleted the event by hand', async () => {
    await addSessionToPhoneCalendar(session(), 'Bradley');
    cal.updateEventAsync.mockRejectedValueOnce(new Error('not found'));
    cal.createEventAsync.mockResolvedValueOnce('evt-2');
    await expect(addSessionToPhoneCalendar(session(), 'Bradley')).resolves.toEqual({ kind: 'added', eventId: 'evt-2' });
  });

  it('reports no writable calendar', async () => {
    cal.getDefaultCalendarAsync.mockRejectedValueOnce(new Error('none'));
    cal.getCalendarsAsync.mockResolvedValueOnce([] as never);
    await expect(addSessionToPhoneCalendar(session(), 'Bradley')).resolves.toEqual({ kind: 'no_calendar' });
  });

  it('never throws on a native failure', async () => {
    cal.createEventAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(addSessionToPhoneCalendar(session(), 'Bradley')).resolves.toEqual({ kind: 'error' });
  });
});

describe('syncPhoneCalendar', () => {
  it('moves the phone event when the session is rescheduled', async () => {
    await addSessionToPhoneCalendar(session(), 'Bradley');
    const moved = session({ start_at: '2026-10-06T16:00:00.000Z', end_at: '2026-10-06T16:15:00.000Z' });
    await expect(syncPhoneCalendar([moved], () => 'Bradley')).resolves.toEqual({ removed: 0, updated: 1 });
    const details = cal.updateEventAsync.mock.calls[0][1];
    expect(details?.startDate).toEqual(new Date('2026-10-06T16:00:00.000Z'));
    expect((await getPhoneEvent('sess-1'))?.start_at).toBe('2026-10-06T16:00:00.000Z');
  });

  it.each(['canceled', 'declined'] as const)('removes the phone event when the session is %s', async (status) => {
    await addSessionToPhoneCalendar(session(), 'Bradley');
    await expect(syncPhoneCalendar([session({ status })], () => 'Bradley')).resolves.toEqual({ removed: 1, updated: 0 });
    expect(cal.deleteEventAsync).toHaveBeenCalledWith('evt-1');
    expect(await getPhoneEvent('sess-1')).toBeNull();
  });

  it('never prompts and does nothing for sessions this device did not add', async () => {
    await syncPhoneCalendar([session()], () => 'Bradley');
    expect(cal.getCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(cal.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('is a no-op without permission (revoked in settings)', async () => {
    await addSessionToPhoneCalendar(session(), 'Bradley');
    cal.getCalendarPermissionsAsync.mockResolvedValue(denied as never);
    await expect(syncPhoneCalendar([session({ status: 'canceled' })], () => 'Bradley')).resolves.toEqual({ removed: 0, updated: 0 });
    expect(cal.deleteEventAsync).not.toHaveBeenCalled();
  });
});

describe('removeSessionFromPhoneCalendar', () => {
  it('deletes the mapped event and forgets it', async () => {
    await addSessionToPhoneCalendar(session(), 'Bradley');
    await expect(removeSessionFromPhoneCalendar('sess-1')).resolves.toBe(true);
    expect(cal.deleteEventAsync).toHaveBeenCalledWith('evt-1');
    await expect(removeSessionFromPhoneCalendar('sess-1')).resolves.toBe(false);
  });
});
