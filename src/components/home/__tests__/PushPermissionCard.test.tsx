import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetPerms = jest.fn();
jest.mock('expo-notifications', () => ({ getPermissionsAsync: () => mockGetPerms() }));
const mockRegister = jest.fn();
jest.mock('../../../services/pushNotifications', () => ({
  registerForPushNotifications: (o: unknown) => mockRegister(o),
}));
const mockUpdate = jest.fn((_t: string) => Promise.resolve());
jest.mock('../../../services/api', () => ({ usersApi: { updatePushToken: (t: string) => mockUpdate(t) } }));
const mockStore = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => mockStore.get(k),
    set: async (k: string, v: string) => void mockStore.set(k, v),
  },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1' }) }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: new Proxy({}, { get: () => '#000000' }) }),
}));

import PushPermissionCard, { pushPrimerDismissedKey } from '../PushPermissionCard';

describe('PushPermissionCard (deferred OS prompt)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
  });

  it('shows when permission is undetermined and prompts only on tap', async () => {
    mockGetPerms.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    mockRegister.mockResolvedValue({ token: 'tok', granted: true });
    const { findByTestId, getByTestId, queryByTestId } = await render(<PushPermissionCard />);
    await findByTestId('push-permission-card');
    expect(mockRegister).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId('push-permission-enable'));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith({ requestPermission: true }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('tok'));
    await waitFor(() => expect(queryByTestId('push-permission-card')).toBeNull());
    expect(mockStore.get(pushPrimerDismissedKey('u1'))).toBe('true');
  });

  it('stays hidden when already granted', async () => {
    mockGetPerms.mockResolvedValue({ status: 'granted', canAskAgain: true });
    const { queryByTestId } = await render(<PushPermissionCard />);
    await new Promise((r) => setTimeout(r, 10));
    expect(queryByTestId('push-permission-card')).toBeNull();
  });

  it('stays hidden after "Not now" (per-user key)', async () => {
    mockStore.set(pushPrimerDismissedKey('u1'), 'true');
    mockGetPerms.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    const { queryByTestId } = await render(<PushPermissionCard />);
    await new Promise((r) => setTimeout(r, 10));
    expect(queryByTestId('push-permission-card')).toBeNull();
    expect(mockGetPerms).not.toHaveBeenCalled();
  });

  it('"Not now" dismisses without prompting', async () => {
    mockGetPerms.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    const { findByTestId, queryByTestId } = await render(<PushPermissionCard />);
    await fireEvent.press(await findByTestId('push-permission-dismiss'));
    await waitFor(() => expect(queryByTestId('push-permission-card')).toBeNull());
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
