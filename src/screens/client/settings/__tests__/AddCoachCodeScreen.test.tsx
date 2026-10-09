/**
 * Decision 133-14: a coachless client adds a coach code from Settings. One
 * attach call with the coach-sharing version, the same sentence and invite
 * error copy as the in-app RoleSelection attach, and the session re-read.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { coachSharingNoticeText } from '../../../../lib/coachSharingNotice';
import { inviteAttachErrorMessage } from '../../../../lib/inviteAttachOutcome';
import { layout } from '../../../../theme/tokens';
import AddCoachCodeScreen from '../AddCoachCodeScreen';

const mockAttach = jest.fn();
const mockPatch = jest.fn(async (_patch: unknown) => {});
const mockRefresh = jest.fn(async () => true);
const mockEmit = jest.fn();
jest.mock('../../../../services/api', () => ({
  authApi: { attachInviteCode: (...a: unknown[]) => mockAttach(...a) },
}));
jest.mock('../../../../lib/userCache', () => ({ patchUserCache: (p: unknown) => mockPatch(p) }));
jest.mock('../../../../lib/coachSharingNotice', () => ({
  ...jest.requireActual('../../../../lib/coachSharingNotice'),
  useCoachSharingNotice: () => 'coach_sharing_join_v1',
}));
jest.mock('../../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ refreshEntitlement: mockRefresh }) }));
jest.mock('../../../../utils/authEvents', () => ({ authEvents: { emit: (e?: string) => mockEmit(e) } }));
jest.mock('../../../../utils/authFailure', () => ({
  isNetworkFailure: () => false,
  unknownAuthFailure: () => ({ message: 'Something did not work. Reference ABC. Contact support.' }),
}));

const goBack = jest.fn();
const renderAt = (top: number) => render(
  <SafeAreaInsetsContext.Provider value={{ top, bottom: 34, left: 0, right: 0 }}>
    <AddCoachCodeScreen navigation={{ goBack }} />
  </SafeAreaInsetsContext.Provider>,
);

beforeEach(() => jest.clearAllMocks());

it.each([24, 47])('sits under the status bar (top inset %i) with the sharing sentence once a code is typed', async (top) => {
  const ui = await renderAt(top);
  expect(StyleSheet.flatten(ui.getByTestId('add-coach-code').props.style).paddingTop).toBe(top + layout.statusBarGap);
  expect(ui.queryByTestId('coach-sharing-notice')).toBeNull();
  await fireEvent.changeText(ui.getByLabelText('Coach code'), 'GP-LEE');
  expect(ui.getByText(coachSharingNoticeText())).toBeTruthy();
});

it('attaches once with the sharing version, patches the user and re-reads the session', async () => {
  mockAttach.mockResolvedValue({ data: { role: 'student', coach_id: 'coach-1' } });
  const ui = await renderAt(24);
  await fireEvent.changeText(ui.getByLabelText('Coach code'), '  GP-LEE ');
  await act(async () => { fireEvent.press(ui.getByRole('button', { name: 'Join coach' })); });
  await waitFor(() => expect(ui.getByText('Coach connected')).toBeTruthy());
  expect(mockAttach).toHaveBeenCalledTimes(1);
  expect(mockAttach).toHaveBeenCalledWith('GP-LEE', 'coach_sharing_join_v1');
  expect(mockPatch).toHaveBeenCalledWith({ coach_id: 'coach-1', role: 'student' });
  expect(mockRefresh).toHaveBeenCalled();
  expect(mockEmit).toHaveBeenCalledWith('login');
  await fireEvent.press(ui.getByRole('button', { name: 'Done' }));
  expect(goBack).toHaveBeenCalled();
});

it('asks for a code before calling, and shows the invite copy on a 4xx', async () => {
  const ui = await renderAt(24);
  await fireEvent.press(ui.getByRole('button', { name: 'Join coach' }));
  expect(ui.getByText('Enter the invite code your coach shared.')).toBeTruthy();
  expect(mockAttach).not.toHaveBeenCalled();
  mockAttach.mockRejectedValue({ response: { status: 410, data: { reason: 'expired' } } });
  await fireEvent.changeText(ui.getByLabelText('Coach code'), 'GP-OLD');
  await act(async () => { fireEvent.press(ui.getByRole('button', { name: 'Join coach' })); });
  await waitFor(() => expect(ui.getByText(inviteAttachErrorMessage('expired'))).toBeTruthy());
  expect(mockPatch).not.toHaveBeenCalled();
  expect(mockEmit).not.toHaveBeenCalled();
});
