import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
const mockUser = jest.fn();
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser() }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 3 }));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (u: string) => mockGet(u) } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: new Proxy({}, { get: () => '#000000' }), colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import HomeHeaderActions, { messageCoachLabel } from '../HomeHeaderActions';

describe('HomeHeaderActions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('labels the message entry with the coach first name', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockResolvedValue({ data: { name: 'Bradley Gleave' } });
    const { findByText } = await render(<HomeHeaderActions />);
    expect(await findByText('Message Bradley')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach');
  });

  it('falls back to "Message your coach" without a coach or on error', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: null });
    const { getByText } = await render(<HomeHeaderActions />);
    expect(getByText('Message your coach')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
    expect(messageCoachLabel('  ')).toBe('Message your coach');
  });

  it('message entry opens Messages; bell opens NotificationCenter with unread label', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockRejectedValue(new Error('404'));
    const { getByTestId, getByLabelText } = await render(<HomeHeaderActions />);
    await fireEvent.press(getByTestId('home-message-coach'));
    expect(mockNavigate).toHaveBeenCalledWith('Messages');
    expect(getByLabelText('Notifications, 3 unread')).toBeTruthy();
    await fireEvent.press(getByTestId('home-notification-bell'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('NotificationCenter'));
  });

  it('HomeScreen mounts the actions and the deferred push card; ClientNavigator has no dead headerRight bell', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'screens', 'client', 'HomeScreen.tsx'), 'utf8');
    expect(home).toMatch(/<HomeHeaderActions \/>/);
    expect(home).toMatch(/<PushPermissionCard \/>/);
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
    expect(nav).not.toMatch(/headerRight: \(\) =>/);
  });
});
