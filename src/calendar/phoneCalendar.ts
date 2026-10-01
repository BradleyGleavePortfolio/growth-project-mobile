/**
 * phoneCalendar — S-SCHED "Add to my calendar".
 *
 * Writes a coaching session into the phone's own calendar (Apple Calendar on
 * iOS, the default Google/Samsung calendar on Android) with expo-calendar.
 * No account is connected and nothing is read from the user's calendar
 * except the event this app created.
 *
 * Rules (owner, 2026-10-01):
 *   - Permission is asked only when the client taps the button.
 *   - Denial is handled calmly: a short note, no repeated prompts.
 *   - A local mapping (sessionId -> phone event id) lets a reschedule move
 *     the phone event and a cancel or decline remove it.
 *
 * The mapping lives in AsyncStorage on this device only. If the client
 * deletes the event by hand, an update finds nothing and the mapping is
 * dropped quietly.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';
import type { CoachingSession } from '../api/schedulingApi';
import { resolveVideoUrl } from '../api/schedulingApi';
import { logger } from '../utils/logger';

const STORAGE_KEY = 'tgp.phoneCalendar.map.v1';

export interface PhoneEventRecord {
  eventId: string;
  start_at: string;
  end_at: string;
}

type PhoneMap = Record<string, PhoneEventRecord>;

export type AddResult =
  | { kind: 'added'; eventId: string }
  | { kind: 'updated'; eventId: string }
  | { kind: 'denied' }
  | { kind: 'no_calendar' }
  | { kind: 'error' };

/** Statuses that mean the session will not happen. */
const GONE_STATUSES = new Set(['canceled', 'declined']);

async function readMap(): Promise<PhoneMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PhoneMap) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: PhoneMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    logger.warn('phoneCalendar', 'mapping write failed', err);
  }
}

export async function getPhoneEvent(sessionId: string): Promise<PhoneEventRecord | null> {
  const map = await readMap();
  return map[sessionId] ?? null;
}

async function pickWritableCalendarId(): Promise<string | null> {
  if (Platform.OS === 'ios') {
    try {
      const def = await Calendar.getDefaultCalendarAsync();
      if (def?.id && def.allowsModifications !== false) return def.id;
    } catch {
      // fall through to the list
    }
  }
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = cals.filter((c) => c.allowsModifications);
  const primary = writable.find((c) => c.isPrimary) ?? writable.find((c) => c.source?.isLocalAccount === false);
  return (primary ?? writable[0])?.id ?? null;
}

function eventDetails(session: CoachingSession, coachName: string) {
  const link = resolveVideoUrl(session.video_url);
  const lines = [`Coaching session with ${coachName}.`];
  if (link) lines.push(`Join: ${link}`);
  lines.push('Open The Growth Project to reschedule or cancel.');
  return {
    title: session.title || `Session with ${coachName}`,
    startDate: new Date(session.start_at),
    endDate: new Date(session.end_at),
    notes: lines.join('\n'),
    url: link ?? undefined,
    alarms: [{ relativeOffset: -60 }],
  };
}

/** Ask for calendar access. Only called from an explicit tap. */
async function ensurePermission(): Promise<boolean> {
  const current = await Calendar.getCalendarPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain === false) return false;
  const asked = await Calendar.requestCalendarPermissionsAsync();
  return asked.granted;
}

/**
 * Add (or refresh) the phone event for this session. Safe to tap twice:
 * an existing mapping updates the same event instead of adding another.
 */
export async function addSessionToPhoneCalendar(
  session: CoachingSession,
  coachName: string,
): Promise<AddResult> {
  try {
    if (!(await ensurePermission())) return { kind: 'denied' };
    const map = await readMap();
    const details = eventDetails(session, coachName);
    const existing = map[session.id];
    if (existing) {
      try {
        await Calendar.updateEventAsync(existing.eventId, details);
        map[session.id] = { eventId: existing.eventId, start_at: session.start_at, end_at: session.end_at };
        await writeMap(map);
        return { kind: 'updated', eventId: existing.eventId };
      } catch {
        // The client removed it by hand; add a fresh one below.
        delete map[session.id];
      }
    }
    const calendarId = await pickWritableCalendarId();
    if (!calendarId) return { kind: 'no_calendar' };
    const eventId = await Calendar.createEventAsync(calendarId, details);
    map[session.id] = { eventId, start_at: session.start_at, end_at: session.end_at };
    await writeMap(map);
    return { kind: 'added', eventId };
  } catch (err) {
    logger.warn('phoneCalendar', 'add failed', err);
    return { kind: 'error' };
  }
}

/**
 * Keep phone events in step with the server. For every session this device
 * added: cancelled or declined -> remove the event; moved -> update times.
 * Never asks for permission; without it this is a no-op.
 */
export async function syncPhoneCalendar(
  sessions: CoachingSession[],
  coachNameFor: (s: CoachingSession) => string,
): Promise<{ removed: number; updated: number }> {
  const result = { removed: 0, updated: 0 };
  const map = await readMap();
  const tracked = sessions.filter((s) => map[s.id]);
  if (tracked.length === 0) return result;
  try {
    const perm = await Calendar.getCalendarPermissionsAsync();
    if (!perm.granted) return result;
  } catch {
    return result;
  }
  for (const s of tracked) {
    const rec = map[s.id];
    try {
      if (GONE_STATUSES.has(s.status)) {
        await Calendar.deleteEventAsync(rec.eventId);
        delete map[s.id];
        result.removed += 1;
      } else if (rec.start_at !== s.start_at || rec.end_at !== s.end_at) {
        await Calendar.updateEventAsync(rec.eventId, eventDetails(s, coachNameFor(s)));
        map[s.id] = { eventId: rec.eventId, start_at: s.start_at, end_at: s.end_at };
        result.updated += 1;
      }
    } catch (err) {
      // Event gone from the phone (deleted by hand): forget it.
      logger.warn('phoneCalendar', 'sync item failed; dropping mapping', err);
      delete map[s.id];
    }
  }
  await writeMap(map);
  return result;
}

/** Remove the phone event for one session right away (after a cancel). */
export async function removeSessionFromPhoneCalendar(sessionId: string): Promise<boolean> {
  const map = await readMap();
  const rec = map[sessionId];
  if (!rec) return false;
  try {
    const perm = await Calendar.getCalendarPermissionsAsync();
    if (perm.granted) await Calendar.deleteEventAsync(rec.eventId);
  } catch (err) {
    logger.warn('phoneCalendar', 'remove failed', err);
  }
  delete map[sessionId];
  await writeMap(map);
  return true;
}

export const __test__ = { STORAGE_KEY };
