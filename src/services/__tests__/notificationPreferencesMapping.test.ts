/**
 * B-NOTIF-6: the Phase 9 preferences screen against the live backend.
 *
 * GET/PATCH /notifications/preferences use flat columns and reject unknown
 * keys (forbidNonWhitelisted), so the nested screen model (channels,
 * muteAll, quietHours) must be mapped both ways. Quiet hours are a fixed
 * 21:00-08:00 window (OR-113-5) and are never sent.
 */

jest.mock('../../config/featureFlags', () => ({ NOTIFICATIONS_MOCK_ENABLED: false }));
jest.mock('../api', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));

import api from '../api';
import {
  fetchNotificationPreferences,
  preferencesFromBackend,
  preferencesToBackend,
  QUIET_HOURS,
  saveNotificationPreferences,
} from '../notificationsApi';

const mockGet = (api as unknown as { get: jest.Mock }).get;
const mockPatch = (api as unknown as { patch: jest.Mock }).patch;

const ROW = {
  user_id: 'u-1',
  muted: false,
  message_push: false,
  message_inapp: true,
  message_email: true,
  milestone_push: true,
  milestone_inapp: false,
  milestone_email: true,
  missed_checkin_push: true,
  missed_checkin_inapp: true,
  missed_checkin_email: false,
  build_week_push: true,
  build_week_inapp: true,
  build_week_email: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '06:00',
  timezone: 'America/New_York',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reading the backend row', () => {
  it('a flat row becomes the screen model (it used to be returned as-is, with no quietHours)', async () => {
    mockGet.mockResolvedValue({ data: ROW });
    const prefs = await fetchNotificationPreferences();
    expect(mockGet).toHaveBeenCalledWith('/notifications/preferences');
    expect(prefs.muteAll).toBe(false);
    expect(prefs.channels.message).toEqual({ push: false, in_app: true, email: true });
    expect(prefs.channels.milestone).toEqual({ push: true, in_app: false, email: true });
    expect(prefs.channels.check_in).toEqual({ push: true, in_app: true, email: false });
    expect(prefs.quietHours).toEqual({ enabled: true, startTime: '21:00', endTime: '08:00' });
  });

  it('the stored quiet_hours_* columns are not shown: the enforced window is', () => {
    expect(preferencesFromBackend(ROW).quietHours).toEqual({ ...QUIET_HOURS });
  });

  it('muted reads through; a missing column reads as on (the schema default)', () => {
    const prefs = preferencesFromBackend({ muted: true });
    expect(prefs.muteAll).toBe(true);
    expect(prefs.channels.build_week).toEqual({ push: true, in_app: true, email: true });
    expect(preferencesFromBackend(null).muteAll).toBe(false);
  });
});

describe('saving', () => {
  it('mute all sends { muted } only', async () => {
    mockPatch.mockResolvedValue({ data: { ...ROW, muted: true } });
    const saved = await saveNotificationPreferences({ muteAll: true });
    expect(mockPatch).toHaveBeenCalledWith('/notifications/preferences', { muted: true });
    expect(saved.muteAll).toBe(true);
  });

  it('a channel switch sends that column, and never quietHours, channels or muteAll keys', async () => {
    mockPatch.mockResolvedValue({ data: { ...ROW, message_push: true } });
    await saveNotificationPreferences({
      channels: { message: { push: true } } as never,
      quietHours: { enabled: false, startTime: '22:00', endTime: '07:00' },
    });
    const body = mockPatch.mock.calls[0][1];
    expect(body).toEqual({ message_push: true });
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['quietHours', 'channels', 'muteAll']));
  });

  it('kinds without a backend switch are not sent', () => {
    expect(
      preferencesToBackend({
        channels: {
          tip: { push: false, in_app: false, email: false },
          system: { push: false, in_app: false, email: false },
          check_in: { push: false, in_app: true, email: true },
        } as never,
      }),
    ).toEqual({ missed_checkin_push: false, missed_checkin_inapp: true, missed_checkin_email: true });
  });

  it('a rejected save is passed to the screen (it restores the switch)', async () => {
    mockPatch.mockRejectedValue(Object.assign(new Error('HTTP 400'), { response: { status: 400 } }));
    await expect(saveNotificationPreferences({ muteAll: true })).rejects.toThrow('HTTP 400');
  });
});
