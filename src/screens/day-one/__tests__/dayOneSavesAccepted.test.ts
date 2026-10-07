/**
 * FU-FIRSTRUN-126 (AUDIT-01-125 U-01-2): every Day-1 write must be one the
 * backend accepts.
 *
 * The backend ValidationPipe runs with whitelist + forbidNonWhitelisted, so a
 * body with any key outside the DTO is rejected with a 400. The Day-1 flow
 * used to send `day_one_goals`, `daily_checkin_time`,
 * `daily_checkin_timezone` and `day_one_completed`, none of which exist in
 * growth-project-backend src/profile/profile.dto.ts (UpdateProfileDto) or
 * src/notifications/notifications.dto.ts (UpdateNotificationPreferencesDto).
 * Every step showed "Couldn't save your progress" and the offline queue
 * never drained.
 *
 * The fake backend below answers like production: 400 for an unknown key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationsApi, preferencesApi, profileApi } from '../../../services/api';
import { completeDayOne, saveCheckInTime, saveGoals, saveNotifPermission } from '../api';
import { flushPendingSync, readResumeState, writeResumeState } from '../resume';
import { readDayOneAnswers } from '../answers';

jest.mock('../../../services/api', () => ({
  authApi: { attachInviteCode: jest.fn() },
  profileApi: { update: jest.fn() },
  preferencesApi: { patch: jest.fn() },
  notificationsApi: { updatePreferences: jest.fn(), setTimezone: jest.fn() },
}));

// The signed-in account the answers are kept for (B-441-1).
jest.mock('../../../lib/userCache', () => ({
  readUserCache: jest.fn(async () => ({ id: 'client-9', email: 'c9@example.com' })),
}));

// Day-1 relevant subset of the backend allow-lists (the fields the client
// may send; anything else is a 400 in production).
const PROFILE_ALLOWED = new Set(['onboarding_completed', 'onboardingCompleted', 'weight_unit', 'bio']);
const NOTIFICATION_PREFS_ALLOWED = new Set(['timezone', 'daily_checkin_enabled', 'muted']);

function badRequest(keys: string[]) {
  return Object.assign(new Error('Request failed with status code 400'), {
    response: {
      status: 400,
      data: { statusCode: 400, message: keys.map((k) => `property ${k} should not exist`) },
    },
  });
}

function strictEndpoint(allowed: Set<string>) {
  return jest.fn((body: Record<string, unknown>) => {
    const unknown = Object.keys(body).filter((k) => !allowed.has(k));
    return unknown.length > 0 ? Promise.reject(badRequest(unknown)) : Promise.resolve({ data: {} });
  });
}

const update = profileApi.update as jest.Mock;
const prefsPatch = preferencesApi.patch as jest.Mock;
const notifPrefs = notificationsApi.updatePreferences as jest.Mock;
const setTimezone = notificationsApi.setTimezone as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  update.mockImplementation(strictEndpoint(PROFILE_ALLOWED));
  notifPrefs.mockImplementation(strictEndpoint(NOTIFICATION_PREFS_ALLOWED));
  // PATCH /users/me/preferences takes an unvalidated partial and ignores
  // unknown keys (users.controller.ts patchPreferences).
  prefsPatch.mockResolvedValue({ data: {} });
  setTimezone.mockResolvedValue({ data: { timezone: 'America/Chicago', stored: true } });
});

describe('Day-1 writes the backend accepts', () => {
  it('finishing Day-1 marks onboarding complete with the backend field', async () => {
    await expect(completeDayOne()).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ onboarding_completed: true });
  });

  it('saving goals keeps them for the account, without a call the backend can only reject', async () => {
    await expect(saveGoals(['fitness', 'mental_health'])).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(notifPrefs).not.toHaveBeenCalled();
    expect((await readDayOneAnswers())?.goals).toEqual(['fitness', 'mental_health']);
  });

  it('saving the check-in time keeps the time and sends only the device zone, with provenance', async () => {
    await expect(saveCheckInTime({ hour: 7, minute: 30 }, 'America/Chicago')).resolves.toBeUndefined();
    expect(setTimezone).toHaveBeenCalledWith('America/Chicago');
    expect(update).not.toHaveBeenCalled();
    expect(notifPrefs).not.toHaveBeenCalled();
    const kept = await readDayOneAnswers('client-9');
    expect(kept?.checkInTime).toEqual({ hour: 7, minute: 30 });
    expect(kept?.checkInTimezone).toBe('America/Chicago');
  });

  it('a backend without PUT /notifications/timezone gets the zone on the preferences route', async () => {
    setTimezone.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }),
    );
    await expect(saveCheckInTime({ hour: 9, minute: 0 }, 'Europe/London')).resolves.toBeUndefined();
    expect(notifPrefs).toHaveBeenCalledWith({ timezone: 'Europe/London' });
  });

  it('a zone the backend refuses does not block the step', async () => {
    setTimezone.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { code: 'TIMEZONE_INVALID' } },
      }),
    );
    await expect(saveCheckInTime({ hour: 9, minute: 0 }, 'Mars/Olympus')).resolves.toBeUndefined();
  });

  it('a network failure still fails the step so "Continue offline" can queue it', async () => {
    setTimezone.mockRejectedValue(new Error('Network Error'));
    await expect(saveCheckInTime({ hour: 9, minute: 0 }, 'America/Chicago')).rejects.toThrow('Network Error');
  });

  it('the notification-permission step still succeeds', async () => {
    await expect(saveNotifPermission('granted')).resolves.toBeUndefined();
  });
});

describe('Day-1 offline queue drains against the backend', () => {
  it('every queued step is accepted, the checkpoint clears and the answers survive', async () => {
    await writeResumeState({
      step: 'Ready',
      pendingSync: [
        { kind: 'goals', goals: ['fitness'] },
        { kind: 'notif', state: 'granted' },
        { kind: 'checkin', time: { hour: 8, minute: 0 }, timezone: 'America/Denver' },
        { kind: 'complete' },
      ],
    });
    await expect(flushPendingSync()).resolves.toBe(4);
    expect(await readResumeState()).toBeNull();
    expect(update).toHaveBeenCalledWith({ onboarding_completed: true });
    const kept = await readDayOneAnswers('client-9');
    expect(kept?.goals).toEqual(['fitness']);
    expect(kept?.checkInTime).toEqual({ hour: 8, minute: 0 });
    expect(kept?.checkInTimezone).toBe('America/Denver');
    // Another account on the phone reads nothing.
    expect(await readDayOneAnswers('someone-else')).toBeNull();
  });
});
