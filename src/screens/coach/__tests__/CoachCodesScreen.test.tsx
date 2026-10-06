/**
 * Coach Codes entry + screen (b#658 code tools). Story: a coach whose code
 * leaked sees the warning, turns the code off, makes a new one and shares
 * its QR; with the server flag off the legacy invite-codes screen shows.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import CoachCodesEntry from '../CoachCodesEntry';
import { coachCodesApi, type CoachCode } from '../../../api/coachCodesApi';

jest.mock('../../../api/coachCodesApi', () => {
  const actual = jest.requireActual('../../../api/coachCodesApi');
  return {
    ...actual,
    coachCodesApi: { list: jest.fn(), signups: jest.fn(), create: jest.fn(), rotate: jest.fn(), revoke: jest.fn() },
  };
});
jest.mock('../InviteCodesScreen', () => {
  const { Text: T } = jest.requireActual('react-native');
  return () => <T>Legacy invite codes</T>;
});
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn().mockResolvedValue('file:///tmp/qr.png') }));
jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn().mockResolvedValue(undefined),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#123456' }),
  }),
}));

const api = jest.mocked(coachCodesApi);
// The entry only hands `navigation` to the (mocked) legacy screen.
const nav: React.ComponentProps<typeof CoachCodesEntry>['navigation'] = Object.assign(Object.create(null), {
  navigate: jest.fn(),
  goBack: jest.fn(),
});

function code(over: Partial<CoachCode>): CoachCode {
  return {
    id: 'row-1',
    kind: 'invite_code',
    code: 'GP-ROW234',
    label: 'Front desk',
    status: 'active',
    issued_by_user_id: null,
    join_url: 'https://app.trygrowthproject.com/join/GP-ROW234',
    qr_payload: 'https://app.trygrowthproject.com/join/GP-ROW234',
    created_at: '2026-10-01T10:00:00.000Z',
    expires_at: null,
    revoked_at: null,
    max_uses: null,
    used_count: 0,
    signups_total: 9,
    signups_7d: 7,
    package: null,
    grant_mode: 'none',
    rotated_from: null,
    rotated_to: null,
    ...over,
  };
}

const LINK = code({ id: 'coach-link', kind: 'coach_link', code: 'GP-LINK22', label: null, join_url: 'https://app.trygrowthproject.com/join/GP-LINK22', qr_payload: 'https://app.trygrowthproject.com/join/GP-LINK22' });
const ROW = code({});

function httpError(status: number, data: Record<string, unknown> = {}) {
  return Object.assign(new Error(`status ${status}`), { response: { status, data } });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.list.mockResolvedValue({ codes: [LINK, ROW], tracking_note: 'Signup counts include every signup since code tools were added to your account.' });
  api.signups.mockResolvedValue({
    timezone: 'America/Los_Angeles', from: '2026-09-29', to: '2026-10-05', total: 7, today: 6, days: [],
    by_code: [
      { code: 'GP-ROW234', id: 'row-1', kind: 'invite_code', label: 'Front desk', total: 7, today: 6, unusual_today: true, days: [] },
      { code: 'GP-LINK22', id: 'coach-link', kind: 'coach_link', label: 'Coach link', total: 0, today: 0, unusual_today: false, days: [] },
    ],
  });
});

async function renderEntry() {
  const utils = await render(<CoachCodesEntry navigation={nav} />);
  await utils.findByTestId('coach-codes-screen');
  return utils;
}

describe('CoachCodesEntry', () => {
  it('shows the legacy invite-codes screen when the server answers 404 coach_code_tools_disabled', async () => {
    api.list.mockRejectedValueOnce(httpError(404, { code: 'coach_code_tools_disabled' }));
    const { findByText, queryByTestId } = await render(<CoachCodesEntry navigation={nav} />);
    expect(await findByText('Legacy invite codes')).toBeTruthy();
    expect(queryByTestId('coach-codes-screen')).toBeNull();
  });

  it('a network failure says so and retries, without falling back to the legacy screen', async () => {
    api.list.mockRejectedValueOnce(new Error('Network Error'));
    const { findByText, getByTestId, findByTestId, queryByText } = await render(<CoachCodesEntry navigation={nav} />);
    expect(await findByText(/could not be reached/)).toBeTruthy();
    expect(queryByText('Legacy invite codes')).toBeNull();
    await act(async () => fireEvent.press(getByTestId('coach-codes-retry')));
    expect(await findByTestId('coach-codes-screen')).toBeTruthy();
  });
});

describe('CoachCodesScreen', () => {
  it("lists the coach link first, today's signups per code, and the unusual-today warning", async () => {
    const { getByTestId, findByTestId, queryByTestId, getByText } = await renderEntry();
    expect(getByText('GP-LINK22')).toBeTruthy();
    expect(getByTestId('coach-code-GP-ROW234')).toBeTruthy();
    expect(await findByTestId('coach-code-unusual-GP-ROW234')).toBeTruthy();
    expect(queryByTestId('coach-code-unusual-GP-LINK22')).toBeNull();
    expect(getByText(/Today 6 signups · 7 days 7 · Total 9/)).toBeTruthy();
    // The coach link can only be rotated, never turned off.
    expect(queryByTestId('coach-code-revoke-GP-LINK22')).toBeNull();
  });

  it('keeps the legacy screen\'s bulk invite and who-joined links', async () => {
    const { getByTestId, queryByTestId } = await renderEntry();
    await fireEvent.press(getByTestId('coach-codes-bulk-invite'));
    expect(nav.navigate).toHaveBeenCalledWith('CoachBulkInvite');
    await fireEvent.press(getByTestId('coach-code-joined-GP-ROW234'));
    expect(nav.navigate).toHaveBeenCalledWith('InviteCodeRedeemers', { inviteCodeId: 'row-1', code: 'GP-ROW234' });
    expect(queryByTestId('coach-code-joined-GP-LINK22')).toBeNull();
  });

  it('turns a leaked code off after confirmation', async () => {
    api.revoke.mockResolvedValue({ code: { ...ROW, status: 'revoked', revoked_at: '2026-10-05T20:00:00Z' }, replayed: false });
    const alert = jest.spyOn(Alert, 'alert');
    const { getByTestId, findByText } = await renderEntry();
    await fireEvent.press(getByTestId('coach-code-revoke-GP-ROW234'));
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => Promise<void> }>;
    await act(async () => buttons.find((b) => b.text === 'Turn off')!.onPress!());
    expect(api.revoke).toHaveBeenCalledWith('row-1');
    expect(await findByText('Off')).toBeTruthy();
  });

  it('create reuses one Idempotency-Key across a retry and adds the new code', async () => {
    const created = code({ id: 'row-2', code: 'GP-NEW567', label: 'Clinic' });
    api.create.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ code: created, replayed: true });
    const { getByTestId, findByText, findByTestId } = await renderEntry();
    await fireEvent.press(getByTestId('coach-code-create-open'));
    await fireEvent.changeText(getByTestId('coach-code-create-label'), 'Clinic');
    await act(async () => fireEvent.press(getByTestId('coach-code-create-submit')));
    expect(await findByTestId('coach-code-create-error')).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId('coach-code-create-submit')));
    expect(api.create).toHaveBeenCalledTimes(2);
    const [k1, k2] = api.create.mock.calls.map((c) => c[1]);
    expect(k1).toBeTruthy();
    expect(k2).toBe(k1);
    expect(api.create.mock.calls[0][0]).toEqual({ label: 'Clinic' });
    expect(await findByText('GP-NEW567')).toBeTruthy();
  });

  it('rotating the coach link sends the code on screen and the chosen grace period', async () => {
    const next = { ...LINK, code: 'GP-LINK99', join_url: 'https://app.trygrowthproject.com/join/GP-LINK99' };
    const prev = code({ id: 'arch-1', code: 'GP-LINK22', label: 'Previous coach link', status: 'retiring', expires_at: '2026-10-06T20:00:00Z' });
    api.rotate.mockResolvedValue({ code: next, previous: prev, replayed: false });
    const { getByTestId, findByText, queryByTestId } = await renderEntry();
    await fireEvent.press(getByTestId('coach-code-rotate-GP-LINK22'));
    await act(async () => fireEvent.press(getByTestId('coach-code-grace-24')));
    expect(api.rotate).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-link', code: 'GP-LINK22' }), 24);
    expect(await findByText('GP-LINK99')).toBeTruthy();
    expect(await findByText(/Keeps working until/)).toBeTruthy();
    // The retiring old link can be turned off early, but is no longer offered for sharing.
    expect(getByTestId('coach-code-revoke-GP-LINK22')).toBeTruthy();
    expect(queryByTestId('coach-code-share-GP-LINK22')).toBeNull();
    expect(getByTestId('coach-code-share-GP-LINK99')).toBeTruthy();
  });

  it('a rotation conflict shows its own sentence and keeps the list', async () => {
    api.rotate.mockRejectedValue(httpError(409, { code: 'code_rotation_conflict', message: 'raw server text' }));
    const { getByTestId, findByText, getByText, queryByText } = await renderEntry();
    await fireEvent.press(getByTestId('coach-code-rotate-GP-LINK22'));
    await act(async () => fireEvent.press(getByTestId('coach-code-grace-0')));
    expect(await findByText(/changed on another device/)).toBeTruthy();
    expect(queryByText('raw server text')).toBeNull();
    expect(getByText('GP-LINK22')).toBeTruthy();
  });

  it('shows the QR for a code and shares it as an image', async () => {
    const Sharing = jest.requireMock('expo-sharing') as { shareAsync: jest.Mock };
    const { getByTestId, findByTestId, getByLabelText } = await renderEntry();
    await fireEvent.press(getByTestId('coach-code-qr-GP-ROW234'));
    expect(await findByTestId('coach-code-qr-sheet')).toBeTruthy();
    expect(getByLabelText('QR code for invite code GP-ROW234')).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId('coach-code-qr-share-image')));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///tmp/qr.png', expect.objectContaining({ mimeType: 'image/png' })));
  });
});

