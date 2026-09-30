/**
 * RoleSelection enter-code retry step (C03 mobile side), behavioural.
 * Reached when signup succeeded but the backend reported
 * `invite_attached:false`.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetSignupPolicy = jest.fn();
const mockAttach = jest.fn();
const mockSelectRole = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: (...a: unknown[]) => mockGetSignupPolicy(...a),
    attachInviteCode: (...a: unknown[]) => mockAttach(...a),
    selectRole: (...a: unknown[]) => mockSelectRole(...a),
    getInvitePreview: jest.fn(() => Promise.resolve({ data: { valid: true } })),
    validateInviteCode: jest.fn(() => Promise.resolve({ data: { valid: true } })),
  },
}));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(() => Promise.resolve('GP-NEW2')) }));
const mockEmit = jest.fn();
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: () => mockEmit() } }));
jest.mock('../../../lib/userCache', () => ({
  readUserCache: jest.fn(() => Promise.resolve({ id: 'u1', role: null })),
  setUserCache: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../services/queryClient', () => ({
  purgePersistedQueryCacheForAllUsers: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import RoleSelectionScreen from '../RoleSelectionScreen';

function route(params?: { inviteAttachError?: string; inviteCode?: string }) {
  return { key: 'k', name: 'RoleSelection' as const, params };
}

describe('RoleSelection retry step', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetSignupPolicy.mockResolvedValue({ data: { invite_code_required: false, providers: ['email', 'apple'] } });
  });

  it('shows friendly retry copy with the code prefilled', async () => {
    const { findByTestId, getByTestId, getByText, queryByText } = await render(
      <RoleSelectionScreen navigation={{} as never} route={route({ inviteAttachError: 'coach_inactive', inviteCode: 'GP-PNW1' })} />,
    );
    const banner = await findByTestId('invite-attach-retry-banner');
    expect(banner).toBeTruthy();
    expect(getByText(/not accepting new clients/)).toBeTruthy();
    expect(queryByText('coach_inactive')).toBeNull();
    expect(getByTestId('role-invite-code-input').props.value).toBe('GP-PNW1');
    expect(getByText('Connect to my coach')).toBeTruthy();
  });

  it('requires a code in retry mode even when policy is codeless', async () => {
    const { findByTestId, getByTestId, findByText } = await render(
      <RoleSelectionScreen navigation={{} as never} route={route({ inviteAttachError: 'invalid' })} />,
    );
    await findByTestId('invite-attach-retry-banner');
    await waitFor(() => expect(mockGetSignupPolicy).toHaveBeenCalled());
    await fireEvent.press(getByTestId('role-continue'));
    expect(await findByText('Enter the invite code your coach shared.')).toBeTruthy();
    expect(mockSelectRole).not.toHaveBeenCalled();
  });

  it('a successful retry attaches, selects student and finishes', async () => {
    mockAttach.mockResolvedValue({ data: { ok: true } });
    mockSelectRole.mockResolvedValue({ data: { role: 'student', coach_id: 'coach-b' } });
    const { findByTestId, getByTestId } = await render(
      <RoleSelectionScreen navigation={{} as never} route={route({ inviteAttachError: 'expired', inviteCode: 'GP-OLD1' })} />,
    );
    await findByTestId('invite-attach-retry-banner');
    await fireEvent.press(getByTestId('role-paste-invite-code'));
    await waitFor(() => expect(getByTestId('role-invite-code-input').props.value).toBe('GP-NEW2'));
    await fireEvent.press(getByTestId('role-continue'));
    await waitFor(() => expect(mockAttach).toHaveBeenCalledWith('GP-NEW2'));
    await waitFor(() => expect(mockSelectRole).toHaveBeenCalledWith('student', 'GP-NEW2'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
  });

  it('a 4xx on retry shows mapped copy, not the raw server string', async () => {
    mockAttach.mockRejectedValue({ response: { status: 400, data: { message: 'Invite code max_uses reached for row 991' } } });
    const { findByTestId, getByTestId, findAllByText, queryByText } = await render(
      <RoleSelectionScreen navigation={{} as never} route={route({ inviteAttachError: 'invalid', inviteCode: 'GP-FULL' })} />,
    );
    await findByTestId('invite-attach-retry-banner');
    await fireEvent.press(getByTestId('role-continue'));
    expect((await findAllByText(/already been used up/)).length).toBeGreaterThan(0);
    expect(queryByText(/row 991/)).toBeNull();
    expect(mockSelectRole).not.toHaveBeenCalled();
  });

  it('explicit skip is offered only when the policy is codeless', async () => {
    mockSelectRole.mockResolvedValue({ data: { role: 'student' } });
    const { findByTestId, getByTestId } = await render(
      <RoleSelectionScreen navigation={{} as never} route={route({ inviteAttachError: 'invalid' })} />,
    );
    await fireEvent.press(await findByTestId('role-skip-coach'));
    await waitFor(() => expect(mockSelectRole).toHaveBeenCalledWith('student', undefined));
    void getByTestId;
  });

  it('no retry banner and no skip on the normal path', async () => {
    const { queryByTestId, findByText } = await render(
      <RoleSelectionScreen navigation={{} as never} route={route()} />,
    );
    expect(await findByText('Continue')).toBeTruthy();
    expect(queryByTestId('invite-attach-retry-banner')).toBeNull();
    expect(queryByTestId('role-skip-coach')).toBeNull();
  });
});
