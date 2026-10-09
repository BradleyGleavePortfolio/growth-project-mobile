import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const R = require('react');
    R.useEffect(() => cb(), [cb]);
  },
}));
const mockUser = jest.fn();
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser() }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 3 }));
const mockGet = jest.fn();
const mockRomanChat = jest.fn(() => false);
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { get romanChat() { return mockRomanChat(); } } }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (u: string) => mockGet(u) } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: new Proxy({}, { get: () => '#000000' }), colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, size }: { name: string; size: number }) =>
    require('react').createElement(require('react-native').Text, { testID: `icon-${name}`, style: { fontSize: size } }),
}));

import HomeHeaderActions, { messageCoachLabel } from '../HomeHeaderActions';

describe('HomeHeaderActions', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRomanChat.mockReturnValue(false); });

  it.each([false, true])('adds the Roman shortcut beside the coach entry only when chat is enabled: %s', async (enabled) => {
    mockRomanChat.mockReturnValue(enabled);
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockResolvedValue({ data: { name: 'Bradley Gleave' } });
    const view = await render(<HomeHeaderActions />);
    expect(await view.findByText('Message Bradley')).toBeTruthy();
    if (!enabled) {
      expect(view.queryByTestId('home-roman-chat')).toBeNull();
      return;
    }
    const avatar = StyleSheet.flatten(view.getByTestId('home-roman-avatar').props.style);
    expect(avatar).toMatchObject({ width: 32, height: 32 });
    expect(StyleSheet.flatten(view.getByTestId('home-roman-chat').props.style)).toMatchObject({ width: 44, height: 44 });
    await fireEvent.press(view.getByLabelText('Chat with Roman'));
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
    await fireEvent.press(view.getByTestId('home-message-coach'));
    expect(mockNavigate).toHaveBeenLastCalledWith('Messages');
    await fireEvent.press(view.getByTestId('home-notification-bell'));
    expect(mockNavigate).toHaveBeenLastCalledWith('NotificationCenter');
  });

  it('keeps both outline header actions at 24 pt', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockResolvedValue({ data: {} });
    const view = await render(<HomeHeaderActions />);
    for (const icon of ['chatbubble-ellipses-outline', 'notifications-outline']) {
      expect(view.getByTestId(`icon-${icon}`).props.style.fontSize).toBe(24);
    }
  });

  // B25: a coachless client is never offered a coach action on Home.
  it('offers a coachless client Roman instead of a coach, with one Roman entry', async () => {
    mockRomanChat.mockReturnValue(true);
    mockUser.mockReturnValue({ id: 'u1', coach_id: null });
    const view = await render(<HomeHeaderActions />);
    expect(view.queryByText(/coach/i)).toBeNull();
    expect(view.queryByLabelText(/coach/i)).toBeNull();
    expect(view.queryByTestId('home-message-coach')).toBeNull();
    expect(view.queryByTestId('icon-chatbubble-ellipses-outline')).toBeNull();
    expect(view.getAllByTestId('home-roman-chat')).toHaveLength(1);
    expect(view.getByText('Ask Roman')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Chat with Roman'));
    expect(mockNavigate).toHaveBeenCalledWith('MoreTab', { screen: 'RomanChat', initial: false });
    await fireEvent.press(view.getByTestId('home-notification-bell'));
    expect(mockNavigate).toHaveBeenLastCalledWith('NotificationCenter');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('shows a coachless client only the bell when Roman chat is off', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: null });
    const view = await render(<HomeHeaderActions />);
    expect(view.queryByText(/coach/i)).toBeNull();
    expect(view.queryByTestId('home-message-coach')).toBeNull();
    expect(view.queryByTestId('home-roman-chat')).toBeNull();
    expect(view.getByTestId('home-leading-empty')).toBeTruthy();
    expect(view.getByTestId('home-notification-bell')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('labels the message entry with the coach first name', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockResolvedValue({ data: { name: 'Bradley Gleave' } });
    const { findByText } = await render(<HomeHeaderActions />);
    expect(await findByText('Message Bradley')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach');
  });

  it('falls back to "Message your coach" when the coach name cannot be read', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockRejectedValue(new Error('404'));
    const { getByText } = await render(<HomeHeaderActions />);
    expect(getByText('Message your coach')).toBeTruthy();
    expect(messageCoachLabel('  ')).toBe('Message your coach');
  });

  it('lets the message action label wrap at larger text sizes', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockRejectedValue(new Error('404'));
    const view = await render(<HomeHeaderActions />);
    const label = view.getByText('Message your coach');
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.allowFontScaling).not.toBe(false);
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

  it('shows the unread coach-message count on the message entry (AUDIT-03-125 U2)', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockImplementation(async (u: string) =>
      u === '/messages/unread-count' ? { data: { total: 2 } } : { data: { name: 'Bradley Gleave' } },
    );
    const { findByLabelText } = await render(<HomeHeaderActions />);
    expect(await findByLabelText('Message Bradley, 2 unread')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/messages/unread-count');
  });

  it('HomeScreen mounts the actions and the deferred push card; ClientNavigator has no dead headerRight bell', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'screens', 'client', 'HomeScreen.tsx'), 'utf8');
    expect(home).toMatch(/<HomeHeaderActions \/>/);
    expect(home).toMatch(/<PushPermissionCard presentation="section" \/>/);
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
    expect(nav).not.toMatch(/headerRight: \(\) =>/);
  });
});
