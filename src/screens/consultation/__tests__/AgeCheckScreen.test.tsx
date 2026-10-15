/**
 * AGEGATE16 (owner #C8-UNDER18-B): the once-only age step for a client who
 * reached the app without a date of birth on file. Every tap path: the
 * wheels, Continue at 16 or older (saves only the date, opens the app),
 * Continue under 16 (the calm final stop screen, nothing saved), both ways
 * back to the wheels, a failed save (error, stays, retry works) and a double
 * tap. Plus the shared 16+ rule and the server-check helper.
 */
const mockUpdate = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  profileApi: { update: (...a: unknown[]) => mockUpdate(...a) },
}));
const mockPatchCache = jest.fn();
jest.mock('../../../lib/userCache', () => ({
  ...jest.requireActual('../../../lib/userCache'),
  patchUserCache: (...a: unknown[]) => mockPatchCache(...a),
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AgeCheckScreen from '../AgeCheckScreen';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { MIN_CLIENT_AGE, clientAgeConfirmed, confirmsMinClientAge } from '../../../lib/ageGate';

const now = new Date();
const START_YEAR = now.getFullYear() - 30;
const isoFor = (y: number) =>
  `${y}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.min(28, now.getDate())).padStart(2, '0')}`;

// FIXAGE2 R6: nothing is picked until the client moves each wheel. Each
// wheel is scrolled to rest on the row it opens at (a real pick).
async function pickStartDate(r: Awaited<ReturnType<typeof render>>) {
  const rows: Array<[string, number]> = [
    ['wheel-dob-month', now.getMonth()],
    ['wheel-dob-day', Math.min(28, now.getDate()) - 1],
    ['wheel-dob-year', 70],
  ];
  for (const [id, row] of rows) {
    await fireEvent(r.getByTestId(`${id}-scroll`), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: row * 44 } } });
  }
}

async function yearsLater(r: Awaited<ReturnType<typeof render>>, n: number) {
  for (let i = 0; i < n; i += 1) {
    await fireEvent(r.getByTestId('wheel-dob-year'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  }
}

let alert: jest.SpyInstance;
let success: jest.SpyInstance;
let error: jest.SpyInstance;
beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue({ data: {} });
  mockPatchCache.mockReset();
  mockPatchCache.mockResolvedValue(undefined);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  success = jest.spyOn(HapticService, 'success').mockResolvedValue(undefined);
  error = jest.spyOn(HapticService, 'error').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('AgeCheckScreen', () => {
  it("asks the consultation's own question, with no chapter, no Back and no Finish later", async () => {
    const r = await render(<AgeCheckScreen onConfirmed={jest.fn()} />);
    expect(r.getByTestId('consult-screen-B2')).toBeTruthy();
    expect(r.getByText('When were you born?')).toBeTruthy();
    expect(r.getByText('Energy needs change with age.')).toBeTruthy();
    expect(r.queryByText(/Chapter/)).toBeNull();
    expect(r.queryByTestId('consult-back')).toBeNull();
    expect(r.queryByTestId('consult-finish-later')).toBeNull();
    expect(r.getByTestId('wheel-dob-year').props.accessibilityValue).toBeUndefined();
  });

  // FIXAGE2 R6: "only a date the client actually chose is ever saved as
  // their date of birth."
  it('no date is pre-chosen: Continue stays off until month, day and year are all picked', async () => {
    const onConfirmed = jest.fn();
    const r = await render(<AgeCheckScreen onConfirmed={onConfirmed} />);
    const off = () => r.getByTestId('consult-continue').props.accessibilityState?.disabled;
    for (const id of ['wheel-dob-month', 'wheel-dob-day', 'wheel-dob-year']) {
      expect([id, r.getByTestId(id).props.accessibilityValue, off()]).toEqual([id, undefined, true]);
    }
    await fireEvent.press(r.getByTestId('consult-continue'));
    await fireEvent(r.getByTestId('wheel-dob-year-scroll'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 70 * 44 } } });
    await fireEvent(r.getByTestId('wheel-dob-month-scroll'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { y: 0 } } });
    expect(off()).toBe(true);
    expect(r.queryByTestId('consult-validation')).toBeNull();
    await fireEvent(r.getByTestId('wheel-dob-day'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(off()).toBe(false);
    await fireEvent.press(r.getByTestId('consult-continue'));
    const day = String(Math.min(28, now.getDate()) + 1).padStart(2, '0');
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ date_of_birth: `${START_YEAR}-01-${day}` }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('16 or older: Continue saves only the date of birth, caches it and opens the app', async () => {
    const onConfirmed = jest.fn();
    const r = await render(<AgeCheckScreen onConfirmed={onConfirmed} />);
    await pickStartDate(r);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ date_of_birth: isoFor(START_YEAR) });
    expect(mockPatchCache).toHaveBeenCalledWith({ profile: { date_of_birth: isoFor(START_YEAR) } });
    expect(success).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('under 16: Continue shows the calm final stop screen and saves nothing; Change keeps the wheels', async () => {
    const onConfirmed = jest.fn();
    const r = await render(<AgeCheckScreen onConfirmed={onConfirmed} />);
    await pickStartDate(r);
    await yearsLater(r, 16);
    expect(r.getByTestId('wheel-dob-year').props.accessibilityValue).toEqual({ text: String(START_YEAR + 16) });
    await fireEvent.press(r.getByTestId('consult-continue'));
    expect(r.getByTestId('consult-screen-UNDER_AGE')).toBeTruthy();
    expect(r.getByText(`The Growth Project is for ages ${MIN_CLIENT_AGE} and up.`)).toBeTruthy();
    expect(r.getByText('If the date was entered by mistake, go back and change it.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-under-age-change'));
    expect(r.getByTestId('wheel-dob-year').props.accessibilityValue).toEqual({ text: String(START_YEAR + 16) });
    // FIXAGE2 R9: the stop screen has no second Back (Change is the same action).
    await fireEvent.press(r.getByTestId('consult-continue'));
    expect(r.queryByTestId('consult-back')).toBeNull();
    await fireEvent.press(r.getByTestId('consult-under-age-change'));
    expect(r.getByTestId('consult-screen-B2')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPatchCache).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('a failed save says so, stays on the question, and Continue again saves', async () => {
    const onConfirmed = jest.fn();
    mockUpdate.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    const r = await render(<AgeCheckScreen onConfirmed={onConfirmed} />);
    await pickStartDate(r);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0][0]).toBe("Couldn't save");
    expect(error).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(r.getByTestId('consult-screen-B2')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('a double tap saves once', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mockUpdate.mockReturnValueOnce(new Promise((res) => (finish = res)));
    const onConfirmed = jest.fn();
    const r = await render(<AgeCheckScreen onConfirmed={onConfirmed} />);
    await pickStartDate(r);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    finish({ data: {} });
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('a cache write failure still opens the app (the server has the date)', async () => {
    mockPatchCache.mockRejectedValueOnce(new Error('disk'));
    const onConfirmed = jest.fn();
    const r = await render(<AgeCheckScreen onConfirmed={onConfirmed} />);
    await pickStartDate(r);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('the 16+ rule (same arithmetic as the server)', () => {
  const NOW = new Date('2026-10-14T12:00:00.000Z');
  it('16 today passes, 16 tomorrow does not, anything unreadable does not', () => {
    expect(MIN_CLIENT_AGE).toBe(16);
    expect(confirmsMinClientAge('2010-10-14', NOW)).toBe(true);
    expect(confirmsMinClientAge('2010-10-14T00:00:00.000Z', NOW)).toBe(true);
    expect(confirmsMinClientAge('2010-10-15', NOW)).toBe(false);
    expect(confirmsMinClientAge('1990-01-01', NOW)).toBe(true);
    for (const v of [null, undefined, '', 'soon', 20, {}]) expect(confirmsMinClientAge(v, NOW)).toBe(false);
  });

  // FIXAGE R2: "a client without a confirmed 16+ date of birth never enters
  // the client app, including when the age read fails, times out or returns
  // a reply with no usable profile."
  const UNDER = isoFor(now.getFullYear() - 14);
  const CACHED: Array<[string, unknown]> = [
    ['missing', {}],
    ['no profile', null],
    ['malformed', { date_of_birth: 'soon' }],
    ['under 16', { date_of_birth: UNDER }],
  ];
  const SERVER: Array<[string, () => Promise<{ data?: unknown }>]> = [
    ['network failure', () => Promise.reject(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))],
    ['timeout', () => Promise.reject(new Error('startup_timeout'))],
    ['bad envelope', async () => ({ data: 'unexpected' })],
    ['no profile', async () => ({ data: { profile: null } })],
    ['no date', async () => ({ data: { profile: { date_of_birth: null } } })],
    ['malformed date', async () => ({ data: { profile: { date_of_birth: 'soon' } } })],
    ['under-16 date', async () => ({ data: { profile: { date_of_birth: UNDER } } })],
  ];
  const ROWS = CACHED.flatMap(([c, cache]) => SERVER.map(([sv, read]) => [c, sv, cache, read] as const));
  it.each(ROWS)('cached %s + server %s: never a yes (the age step)', async (_c, _s, cache, read) => {
    const save = jest.fn(async () => undefined);
    expect(await clientAgeConfirmed(cache as Parameters<typeof clientAgeConfirmed>[0], read, save)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('controls: a cached adult skips the read; a server adult and exactly 16 are cached once; a cache failure still opens', async () => {
    const save = jest.fn(async () => undefined);
    const me = jest.fn();
    expect(await clientAgeConfirmed({ date_of_birth: '1990-01-01' }, me, save)).toBe(true);
    expect(await clientAgeConfirmed({ dob: '1990-01-01' }, me, save)).toBe(true);
    expect(me).not.toHaveBeenCalled();
    me.mockResolvedValueOnce({ data: { profile: { date_of_birth: '1990-01-01T00:00:00.000Z' } } });
    expect(await clientAgeConfirmed({}, me, save)).toBe(true);
    expect(save).toHaveBeenCalledWith('1990-01-01T00:00:00.000Z');
    const sixteenToday = new Date(Date.UTC(now.getUTCFullYear() - 16, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
    me.mockResolvedValueOnce({ data: { profile: { date_of_birth: sixteenToday } } });
    expect(await clientAgeConfirmed({ date_of_birth: UNDER }, me, save)).toBe(true);
    me.mockResolvedValueOnce({ data: { profile: { date_of_birth: '1990-01-01' } } });
    save.mockRejectedValueOnce(new Error('disk'));
    expect(await clientAgeConfirmed({}, me, save)).toBe(true);
  });
});
