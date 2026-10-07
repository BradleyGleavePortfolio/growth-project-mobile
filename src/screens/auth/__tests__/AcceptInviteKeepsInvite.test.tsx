/**
 * m#502 Sol B1: an existing client opens an emailed coach invite and taps
 * Sign in. The validated invite must survive the sign-in handoff and reach
 * the explicit attach surface on Home (PendingInviteBanner, with the
 * coach-sharing notice) instead of being dropped. Nothing attaches until
 * the client taps Attach.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockAccept = jest.fn();
const mockSession = jest.fn();
const mockAttach = jest.fn();
jest.mock('../../../api/invites', () => ({
  invitesApi: { acceptInvite: (...a: unknown[]) => mockAccept(...a) },
}));
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: { getItem: () => mockSession() },
}));
jest.mock('../../../services/api', () => ({
  authApi: { attachInviteCode: (...a: unknown[]) => mockAttach(...a) },
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../../../constants/colors').default }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import AcceptInviteScreen from '../AcceptInviteScreen';
import PendingInviteBanner from '../../../components/PendingInviteBanner';
import { readPendingInviteCode } from '../../../lib/pendingInviteCode';

type InviteProps = React.ComponentProps<typeof AcceptInviteScreen>;
function invite(navigate: jest.Mock) {
  const stub: Partial<InviteProps['navigation']> = { navigate };
  return (
    <AcceptInviteScreen
      navigation={stub as InviteProps['navigation']}
      route={{ key: 'invite', name: 'AcceptInvite', params: { token: 'GP-TEST1' } }}
    />
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAccept.mockResolvedValue({ accepted: true, coachName: 'Coach Avery', email: 'member@example.test' });
  mockAttach.mockResolvedValue({ data: { coach_id: 'coach-1' } });
});

describe('invite survives the Sign in handoff', () => {
  it('Sign in keeps the invite, then Home offers an explicit attach with that code', async () => {
    mockSession.mockResolvedValue(null);
    const navigate = jest.fn();
    const view = await render(invite(navigate));
    await fireEvent.press(await view.findByLabelText('Sign in'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('Login', { email: 'member@example.test' }));
    expect(await readPendingInviteCode()).toBe('GP-TEST1');
    view.unmount();

    // After sign-in the client lands on Home, which mounts the banner.
    const home = await render(<PendingInviteBanner />);
    expect(await home.findByText(/GP-TEST1/)).toBeTruthy();
    expect(mockAttach).not.toHaveBeenCalled();
    await fireEvent.press(home.getByLabelText('Attach invite code'));
    await waitFor(() => expect(mockAttach).toHaveBeenCalledTimes(1));
    expect(mockAttach.mock.calls[0][0]).toBe('GP-TEST1');
  });
});
