import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import NotificationPreferencesScreen, {
  categoriesForRole,
  serverValueOf,
  workoutRemindersFromServer,
} from '../NotificationPreferencesScreen';
import { preferenceSaveFailureOf } from '../notificationPreferenceErrors';
import { notificationsApi } from '../../../services/api';
import { SUPPORT_EMAIL } from '../../../constants/support';

// C05 item 7 — Settings > Notifications > Workout reminders (default on).

jest.mock('../../../services/api', () => ({
  notificationsApi: {
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
  },
}));

jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
const mockReport = jest.fn();
jest.mock('../../../lib/consultation/report', () => ({
  reportUnexpected: (...a: unknown[]) => mockReport(...a),
}));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F4F1EA',
      surface: '#FFFFFF',
      border: '#E0DDD8',
      primary: '#2C4A36',
      textPrimary: '#1A1A1A',
      textSecondary: '#444444',
      textMuted: '#777777',
      white: '#FFFFFF',
    },
  }),
}));

const mockGet = notificationsApi.getPreferences as jest.Mock;
const mockUpdate = notificationsApi.updatePreferences as jest.Mock;
function cast<T>(v: unknown): T {
  return v as T;
}
const navigation = cast<Parameters<typeof NotificationPreferencesScreen>[0]['navigation']>({ goBack: jest.fn() });

beforeEach(async () => {
  jest.clearAllMocks();
  // Drop queued once-values so a failed test cannot leak into the next.
  mockGet.mockReset();
  mockUpdate.mockReset();
  await AsyncStorage.clear();
});

describe('workoutRemindersFromServer', () => {
  it('reads the boolean and ignores anything else', () => {
    expect(workoutRemindersFromServer({ workout_reminder_push: false })).toBe(false);
    expect(workoutRemindersFromServer({ workout_reminder_push: true })).toBe(true);
    expect(workoutRemindersFromServer({})).toBeNull();
    expect(workoutRemindersFromServer(null)).toBeNull();
  });
});

describe('NotificationPreferencesScreen — workout reminders', () => {
  it('shows the toggle on by default', async () => {
    mockGet.mockResolvedValue({ data: {} });
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    expect(toggle.props.value).toBe(true);
  });

  it('reflects the server value', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: false } });
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    expect(toggle.props.value).toBe(false);
  });

  it('turning it off patches both workout reminder channels', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    mockUpdate.mockResolvedValue({ data: {} });
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ workout_reminder_push: false, workout_reminder_inapp: false }),
    );
  });

  it('the server value wins over a stale local copy', async () => {
    await AsyncStorage.setItem(
      'gp_notif_category_prefs',
      JSON.stringify({ workout_reminders: true }),
    );
    mockGet.mockResolvedValue({ data: { workout_reminder_push: false } });
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    expect(toggle.props.value).toBe(false);
  });

  it('offline on open: the locally stored value stands', async () => {
    await AsyncStorage.setItem(
      'gp_notif_category_prefs',
      JSON.stringify({ workout_reminders: false }),
    );
    mockGet.mockRejectedValue(new Error('offline'));
    const { findByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const toggle = await findByLabelText('Workout reminders');
    expect(toggle.props.value).toBe(false);
  });

  it('a failed save with no connection rolls the switch back and says what to do (B-312-1)', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    mockUpdate.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    const { findByLabelText, findByTestId } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    const toggle = await findByLabelText('Workout reminders');
    await fireEvent(toggle, 'valueChange', false);
    const text = await findByTestId('notif-pref-save-error-text');
    expect(text.props.children).toBe(
      'Your workout reminder setting was not saved because the app could not reach the server, so it was left as it was. Check your connection, then try again.',
    );
    expect((await findByLabelText('Workout reminders')).props.value).toBe(true);
    expect(mockReport).not.toHaveBeenCalled();
  });
});

function httpError(status: number, data: Record<string, unknown> = {}, sentId = 'app-sent-0001-aaaa') {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data, headers: {} },
    config: { headers: { 'X-Request-Id': sentId } },
  });
}

describe('B-312-1: a toggle that could not be saved says what happened, by status', () => {
  it('401: signed out, sign in again; not reported', () => {
    const out = preferenceSaveFailureOf(httpError(401), 'workout reminder');
    expect(out).toEqual({
      kind: 'signed_out',
      message: 'You were signed out, so your workout reminder setting was not saved. Sign in again, then change it.',
      reference: null,
    });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('429: changed too often, wait a minute; not reported', () => {
    const out = preferenceSaveFailureOf(httpError(429), 'workout reminder');
    expect(out.kind).toBe('busy');
    expect(out.message).toMatch(/Wait a minute, then try again\.$/);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('5xx: the server reference, a support path and a Sentry report with status and code', () => {
    const out = preferenceSaveFailureOf(
      httpError(500, { code: 'INTERNAL', request_id: 'srv12345-6789' }),
      'workout reminder',
    );
    expect(out.kind).toBe('server');
    expect(out.reference).toBe('srv12345');
    expect(out.message).toMatch(/could not be saved, so it was left as it was\. Try again in a moment\./);
    expect(out.message).toMatch(/write to support at \S+@\S+ and mention reference srv12345\.$/);
    expect(mockReport).toHaveBeenCalledWith('PATCH /notifications/preferences', {
      status: 500,
      code: 'INTERNAL',
      requestId: 'srv12345-6789',
    });
  });

  it('a 400 from an older backend is not called a connection problem; it carries the app-sent reference', () => {
    const out = preferenceSaveFailureOf(
      httpError(400, { message: ['property workout_reminder_push should not exist'] }),
      'workout reminder',
    );
    expect(out.kind).toBe('server');
    expect(out.message).not.toMatch(/connection/i);
    expect(out.reference).toBe('app-sent');
    expect(mockReport).toHaveBeenCalledWith(
      'PATCH /notifications/preferences',
      expect.objectContaining({ status: 400, code: null, requestId: 'app-sent-0001-aaaa' }),
    );
  });

  it('a failure that is not an HTTP error is unexpected, not a connection problem', () => {
    const out = preferenceSaveFailureOf(new TypeError('x is undefined'), 'workout reminder');
    expect(out.kind).toBe('server');
    expect(out.message).not.toMatch(/connection/i);
    expect(mockReport).toHaveBeenCalledWith(
      'PATCH /notifications/preferences',
      expect.objectContaining({ status: null }),
    );
  });

  it('the screen shows the server failure inline with its reference and clears it on the next change', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    mockUpdate
      .mockRejectedValueOnce(httpError(503, { request_id: 'abcd1234-ffff' }))
      .mockResolvedValueOnce({ data: {} });
    const { findByLabelText, findByTestId, queryByTestId } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    const notice = await findByTestId('notif-pref-save-error');
    expect(notice.props.accessibilityRole).toBe('alert');
    expect((await findByTestId('notif-pref-save-error-text')).props.children).toMatch(
      /mention reference abcd1234\.$/,
    );
    expect((await findByLabelText('Workout reminders')).props.value).toBe(true);
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    await waitFor(() => expect(queryByTestId('notif-pref-save-error')).toBeNull());
  });

  it('every category names its own setting in the message', async () => {
    mockGet.mockResolvedValue({ data: {} });
    mockUpdate.mockRejectedValue(httpError(401));
    const { findByLabelText, findByTestId } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    await fireEvent(await findByLabelText('Coach Messages'), 'valueChange', false);
    expect((await findByTestId('notif-pref-save-error-text')).props.children).toBe(
      'You were signed out, so your coach message setting was not saved. Sign in again, then change it.',
    );
  });
});

describe('C-312-2: workout reminders are a client setting', () => {
  it.each(['coach', 'owner', 'sub_coach'])('%s does not see the workout reminder switch', async (r) => {
    expect(categoriesForRole(r).map((c) => c.id)).not.toContain('workout_reminders');
    mockGet.mockResolvedValue({ data: {} });
    const { findByLabelText, queryByLabelText } = await render(
      <NotificationPreferencesScreen navigation={navigation} role={() => r} />,
    );
    expect(await findByLabelText('Coach Messages')).toBeTruthy();
    expect(queryByLabelText('Workout reminders')).toBeNull();
  });

  it('a client (student) sees it, and so does an account whose role is not known yet', async () => {
    expect(categoriesForRole('student').map((c) => c.id)).toContain('workout_reminders');
    expect(categoriesForRole(null).map((c) => c.id)).toContain('workout_reminders');
    mockGet.mockResolvedValue({ data: {} });
    const { findByLabelText } = await render(
      <NotificationPreferencesScreen navigation={navigation} role={() => 'student'} />,
    );
    expect(await findByLabelText('Workout reminders')).toBeTruthy();
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Flip a switch without waiting for its save (held by a deferred promise).
 * fireEvent returns the handler's promise, and both `await fireEvent` and an
 * async helper that returns it would adopt that pending promise and hang, so
 * the handler's promise is handed back boxed and the test settles it inside
 * act. Resolves once the PATCH has been issued (or was not, for a blocked
 * change: then `sent` is false).
 */
async function flip(
  el: Parameters<typeof fireEvent>[0],
  value: boolean,
): Promise<{ settled: Promise<unknown> }> {
  const before = mockUpdate.mock.calls.length;
  const settled: Promise<unknown> = fireEvent(el, 'valueChange', value);
  // Let the handler run up to its first held await.
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(before));
  return { settled };
}

describe('B-312-2: overlapping preference writes', () => {
  it('a second change while the first is in flight is not sent, and the switch is disabled until the server answers', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    const first = deferred<{ data: object }>();
    mockUpdate.mockReturnValueOnce(first.promise);
    const { findByLabelText, getByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const firstCall = await flip(await findByLabelText('Workout reminders'), false);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const busy = await findByLabelText('Workout reminders');
    expect(busy.props.value).toBe(false);
    expect(busy.props.disabled).toBe(true);
    // Rapid off-then-on: the "on" must not race the pending "off".
    await flip(busy, true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect((await findByLabelText('Workout reminders')).props.value).toBe(false);
    await act(async () => {
      first.resolve({ data: {} });
      await firstCall.settled;
    });
    await waitFor(() => expect((getByLabelText('Workout reminders')).props.disabled).toBe(false));
    // Now a new change is sent and the screen matches the last saved value.
    mockUpdate.mockResolvedValueOnce({ data: {} });
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', true);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    expect(mockUpdate).toHaveBeenLastCalledWith({ workout_reminder_push: true, workout_reminder_inapp: true });
    expect((await findByLabelText('Workout reminders')).props.value).toBe(true);
  });

  it('an older failure in one category does not undo a newer saved change in another', async () => {
    mockGet.mockResolvedValue({ data: {} });
    const coach = deferred<{ data: object }>();
    mockUpdate.mockReturnValueOnce(coach.promise).mockResolvedValueOnce({ data: {} });
    const { findByLabelText, getByLabelText } = await render(<NotificationPreferencesScreen navigation={navigation} />);
    const coachCall = await flip(await findByLabelText('Coach Messages'), false);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    expect((await findByLabelText('Workout reminders')).props.value).toBe(false);
    await act(async () => {
      coach.reject(httpError(401));
      await coachCall.settled;
    });
    await waitFor(() => expect((getByLabelText('Coach Messages')).props.value).toBe(true));
    expect((await findByLabelText('Workout reminders')).props.value).toBe(false);
    expect(JSON.parse((await AsyncStorage.getItem('gp_notif_category_prefs')) ?? '{}')).toMatchObject({
      coach_direct: true,
      workout_reminders: false,
    });
  });

  it('after an ambiguous failure the switch shows the server value', async () => {
    // The write timed out but reached the server; the server now says off.
    mockGet
      .mockResolvedValueOnce({ data: { workout_reminder_push: true } })
      .mockResolvedValueOnce({ data: { workout_reminder_push: false } });
    mockUpdate.mockRejectedValueOnce(Object.assign(new Error('timeout of 15000ms exceeded'), { isAxiosError: true }));
    const { findByLabelText, findByTestId, getByLabelText } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    await findByTestId('notif-pref-save-error');
    await waitFor(() => expect((getByLabelText('Workout reminders')).props.value).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('serverValueOf reads each category from its first backend field', () => {
    expect(serverValueOf('coach_direct', { message_push: false })).toBe(false);
    expect(serverValueOf('workout_reminders', { workout_reminder_push: true })).toBe(true);
    expect(serverValueOf('system', { weekly_summary_enabled: 'yes' })).toBeNull();
    expect(serverValueOf('milestones', null)).toBeNull();
  });
});

describe('B-312-1: every failure notice carries a working next action', () => {
  it('Try again re-sends the change the user made and clears the notice on success', async () => {
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    mockUpdate
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }))
      .mockResolvedValueOnce({ data: {} });
    const { findByLabelText, findByTestId, queryByTestId } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    await findByTestId('notif-pref-save-error');
    expect((await findByLabelText('Workout reminders')).props.value).toBe(true);
    expect(queryByTestId('notif-pref-save-error-support')).toBeNull(); // offline: no support step
    await fireEvent.press(await findByTestId('notif-pref-save-error-retry'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
    expect(mockUpdate).toHaveBeenLastCalledWith({ workout_reminder_push: false, workout_reminder_inapp: false });
    await waitFor(() => expect(queryByTestId('notif-pref-save-error')).toBeNull());
    expect((await findByLabelText('Workout reminders')).props.value).toBe(false);
  });

  it('a server failure offers Write to support with the reference in the subject', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    mockUpdate.mockRejectedValueOnce(httpError(500, { request_id: 'abcd1234-ffff' }));
    const { findByLabelText, findByTestId } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    await fireEvent.press(await findByTestId('notif-pref-save-error-support'));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const url = String(open.mock.calls[0][0]);
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}`)).toBe(true);
    expect(decodeURIComponent(url)).toContain('reference abcd1234');
    open.mockRestore();
  });

  it('when no email app opens, the support address is shown to copy (never a dead end)', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    mockGet.mockResolvedValue({ data: { workout_reminder_push: true } });
    mockUpdate.mockRejectedValueOnce(httpError(502));
    const { findByLabelText, findByTestId } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    await fireEvent.press(await findByTestId('notif-pref-save-error-support'));
    expect((await findByTestId('notif-pref-support-fallback-address')).props.children).toBe(SUPPORT_EMAIL);
    open.mockRestore();
  });

  it('signed out shows no action (the app is already returning to sign-in)', async () => {
    mockGet.mockResolvedValue({ data: {} });
    mockUpdate.mockRejectedValueOnce(httpError(401));
    const { findByLabelText, findByTestId, queryByTestId } = await render(
      <NotificationPreferencesScreen navigation={navigation} />,
    );
    await fireEvent(await findByLabelText('Workout reminders'), 'valueChange', false);
    await findByTestId('notif-pref-save-error');
    expect(queryByTestId('notif-pref-save-error-retry')).toBeNull();
    expect(queryByTestId('notif-pref-save-error-support')).toBeNull();
  });
});
