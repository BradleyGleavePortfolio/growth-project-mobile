/**
 * Decision 133-14: a coachless client adds a coach code from Settings.
 * CLIENT-POLISH-134: the same endpoint as the coachless Home sheet
 * (POST /coachless/coach-code/redeem, one Idempotency-Key per attempt), the
 * same refusal copy, the coach-sharing version, a pasted join link becomes the
 * code inside it, and the session is re-read.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { coachSharingNoticeText } from '../../../../lib/coachSharingNotice';
import { refusalLine } from '../../../../components/coachless/coachlessCopy';
import { layout } from '../../../../theme/tokens';
import AddCoachCodeScreen, { coachCodeFromInput } from '../AddCoachCodeScreen';

const mockRedeem = jest.fn();
const mockPatch = jest.fn(async (_patch: unknown) => {});
const mockRefresh = jest.fn(async () => true);
const mockEmit = jest.fn();
let mockKeys = 0;
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../../../api/coachlessApi', () => ({
  ...jest.requireActual('../../../../api/coachlessApi'),
  redeemCoachCode: (...a: unknown[]) => mockRedeem(...a),
}));
jest.mock('../../../../utils/idempotency', () => ({ generateIdempotencyKey: () => `key-${++mockKeys}` }));
jest.mock('../../../../lib/userCache', () => ({ patchUserCache: (p: unknown) => mockPatch(p) }));
jest.mock('../../../../lib/coachSharingNotice', () => ({
  ...jest.requireActual('../../../../lib/coachSharingNotice'),
  useCoachSharingNotice: () => 'coach_sharing_join_v1',
}));
jest.mock('../../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: mockRefresh }) }));
jest.mock('../../../../utils/authEvents', () => ({ authEvents: { emit: (e?: string) => mockEmit(e) } }));

const REDEEMED = {
  status: 'attached', already_attached: false,
  coach: { id: 'coach-1', name: 'Lee Park', photo_url: null, business_name: null, bio: null },
  next: { featured_package: null, packages_available: 0 }, grant: null, replayed: false,
};

const goBack = jest.fn();
const renderAt = (top: number) => render(
  <SafeAreaInsetsContext.Provider value={{ top, bottom: 34, left: 0, right: 0 }}>
    <AddCoachCodeScreen navigation={{ goBack }} />
  </SafeAreaInsetsContext.Provider>,
);
const join = async (ui: Awaited<ReturnType<typeof renderAt>>) => {
  await act(async () => { fireEvent.press(ui.getByRole('button', { name: 'Join coach' })); });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockKeys = 0;
});

it.each([24, 47])('sits under the status bar (top inset %i) with the sharing sentence once a code is typed', async (top) => {
  const ui = await renderAt(top);
  expect(StyleSheet.flatten(ui.getByTestId('add-coach-code').props.style).paddingTop).toBe(top + layout.statusBarGap);
  expect(ui.queryByTestId('coach-sharing-notice')).toBeNull();
  await fireEvent.changeText(ui.getByLabelText('Coach code'), 'GP-LEE');
  expect(ui.getByText(coachSharingNoticeText())).toBeTruthy();
});

it('redeems once through the shared endpoint with a key and the sharing version, then re-reads the session', async () => {
  mockRedeem.mockResolvedValue(REDEEMED);
  const ui = await renderAt(24);
  await fireEvent.changeText(ui.getByLabelText('Coach code'), '  GP-LEE ');
  await join(ui);
  await waitFor(() => expect(ui.getByText('Coach connected')).toBeTruthy());
  expect(mockRedeem).toHaveBeenCalledTimes(1);
  expect(mockRedeem).toHaveBeenCalledWith('GP-LEE', 'key-1', 'coach_sharing_join_v1');
  expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'coach-1' });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockEmit).toHaveBeenCalledWith('login');
  await fireEvent.press(ui.getByRole('button', { name: 'Done' }));
  expect(goBack).toHaveBeenCalled();
});

it('asks for a code before calling, shows the coachless refusal line, and keeps the key for a retry', async () => {
  const ui = await renderAt(24);
  await fireEvent.press(ui.getByRole('button', { name: 'Join coach' }));
  expect(ui.getByText('Enter the code the coach shared.')).toBeTruthy();
  expect(mockRedeem).not.toHaveBeenCalled();
  mockRedeem.mockRejectedValue({ response: { status: 410, data: { code: 'code_expired' } } });
  await fireEvent.changeText(ui.getByLabelText('Coach code'), 'GP-OLD');
  await join(ui);
  await waitFor(() => expect(ui.getByText(refusalLine({ code: 'code_expired', status: 410, requestId: null }))).toBeTruthy());
  expect(mockPatch).not.toHaveBeenCalled();
  expect(mockEmit).not.toHaveBeenCalled();
  // Same code again: same attempt key. A different code: a new key.
  await join(ui);
  expect(mockRedeem.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1']);
  await fireEvent.changeText(ui.getByLabelText('Coach code'), 'GP-NEW');
  await join(ui);
  expect(mockRedeem.mock.calls[2][1]).toBe('key-2');
});

it('says when a featured coach is paused (the refusal the Settings path used to skip)', async () => {
  mockRedeem.mockRejectedValue({ response: { status: 409, data: { code: 'coach_not_accepting' } } });
  const ui = await renderAt(24);
  await fireEvent.changeText(ui.getByLabelText('Coach code'), 'GP-BRADLEY');
  await join(ui);
  await waitFor(() => expect(ui.getByTestId('add-coach-code-error')).toHaveTextContent(
    refusalLine({ code: 'coach_not_accepting', status: 409, requestId: null }),
  ));
});

describe('a pasted invite link', () => {
  it.each([
    ['https://app.trygrowthproject.com/join/GP-LEE', 'GP-LEE'],
    ['tgp://join/gp-lee', 'GP-LEE'],
    ['https://app.trygrowthproject.com/join?code=GP-LEE', 'GP-LEE'],
  ])('%s fills the field with %s and redeems that code', async (link, expected) => {
    mockRedeem.mockResolvedValue(REDEEMED);
    const ui = await renderAt(24);
    await fireEvent.changeText(ui.getByLabelText('Coach code'), link);
    expect(ui.getByLabelText('Coach code').props.value).toBe(expected);
    await join(ui);
    expect(mockRedeem).toHaveBeenCalledWith(expected, 'key-1', 'coach_sharing_join_v1');
  });

  it('keeps a typed code as typed, and a link with no code as pasted (the server says why)', () => {
    expect(coachCodeFromInput(' GP-LEE ')).toBe('GP-LEE');
    expect(coachCodeFromInput('GP LEE')).toBe('GP LEE');
    expect(coachCodeFromInput('https://app.trygrowthproject.com/join/')).toBe('https://app.trygrowthproject.com/join/');
  });
});
