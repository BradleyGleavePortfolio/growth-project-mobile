import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
const mockStyleB = jest.fn(() => false);
jest.mock('../../../config/featureFlags', () => ({ featureFlags: {
  get romanChat() { return mockRomanChat(); },
  get c3StyleB() { return mockStyleB(); },
} }));
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
  beforeEach(() => { jest.clearAllMocks(); mockRomanChat.mockReturnValue(false); mockStyleB.mockReturnValue(false); });

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
      expect((await view.findByTestId(`icon-${icon}`)).props.style.fontSize).toBe(24);
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

  it('chooses coach or Roman only once the cached user is known (no Ask Roman flash for a coached client)', async () => {
    mockRomanChat.mockReturnValue(true);
    mockUser.mockReturnValue(null);
    mockGet.mockResolvedValue({ data: { name: 'Bradley Gleave' } });
    const view = await render(<HomeHeaderActions />);
    expect(view.queryByText('Ask Roman')).toBeNull();
    expect(view.queryByTestId('home-message-coach')).toBeNull();
    expect(view.getByTestId('home-leading-empty')).toBeTruthy();
    expect(view.getByTestId('home-notification-bell')).toBeTruthy();
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    await view.rerender(<HomeHeaderActions />);
    expect(await view.findByText('Message Bradley')).toBeTruthy();
    expect(view.queryByText('Ask Roman')).toBeNull();
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
    const { findByText } = await render(<HomeHeaderActions />);
    expect(await findByText('Message your coach')).toBeTruthy();
    expect(messageCoachLabel('  ')).toBe('Message your coach');
  });

  it('lets the message action label wrap at larger text sizes', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockRejectedValue(new Error('404'));
    const view = await render(<HomeHeaderActions />);
    const label = await view.findByText('Message your coach');
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.allowFontScaling).not.toBe(false);
  });

  it('message entry opens Messages; bell opens NotificationCenter with unread label', async () => {
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockRejectedValue(new Error('404'));
    const { findByTestId, getByTestId, getByLabelText } = await render(<HomeHeaderActions />);
    await fireEvent.press(await findByTestId('home-message-coach'));
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

  // FR-880: a block or unblock reads the count again at once (the server counts a blocked pair 0), not on the 30 s tick.
  // FR-880R2: while my block stands Home offers no "Message {coach}" at all; the unblock brings it back with its count.
  it('a block hides the coach entry at once and an unblock brings it back, the count read again', async () => {
    let total = 2;
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockImplementation(async (u: string) =>
      u === '/messages/unread-count' ? { data: { total } } : { data: { name: 'Bradley Gleave' } },
    );
    const view = await render(<HomeHeaderActions />);
    expect(await view.findByLabelText('Message Bradley, 2 unread')).toBeTruthy();
    const { useBlockedUsersStore } = jest.requireActual('../../../store/blockedUsersStore');
    total = 0;
    const reads = mockGet.mock.calls.filter(([u]) => u === '/messages/unread-count').length;
    await act(async () => useBlockedUsersStore.setState({ blocked: [{ id: 'c1', displayName: 'Bradley', blockedAt: '2026-10-24T00:00:00Z' }] }));
    expect(view.queryByTestId('home-message-coach')).toBeNull();
    expect(view.queryByText(/Bradley/)).toBeNull();
    expect(view.getByTestId('home-leading-empty')).toBeTruthy();
    await waitFor(() => expect(mockGet.mock.calls.filter(([u]) => u === '/messages/unread-count').length).toBe(reads + 1));
    total = 2;
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(await view.findByLabelText('Message Bradley, 2 unread')).toBeTruthy();
  });

  // FR-880R2 (operator call on m#880; owner 10-23 "Dissapear"): the coach's block closes the chat too. The thread read
  // answers 200 [] with x-conversation-closed (b#1141); Home then offers no "Message {coach}" until a read says open.
  describe('the coach blocked me', () => {
    const { queryClient } = jest.requireActual('../../../services/queryClient');
    const { COACH_CHAT_KEY } = jest.requireActual('../../../hooks/useCoachChatClosed');
    afterEach(() => queryClient.clear());
    const serve = (closed: { now: boolean }) => mockGet.mockImplementation(async (u: string) => {
      if (u === '/messages?limit=1') return { data: [], headers: closed.now ? { 'x-conversation-closed': 'blocked_by_them' } : {} };
      return u === '/messages/unread-count' ? { data: { total: 0 } } : { data: { name: 'Bradley Gleave' } };
    });

    it.each([false, true])('no coach entry while the thread read says closed (rings %s); a read that says open brings it back', async (rings) => {
      mockRomanChat.mockReturnValue(true);
      mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
      const closed = { now: true };
      serve(closed);
      const view = await render(<HomeHeaderActions layout={rings ? 'rings' : undefined} />);
      await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/messages?limit=1'));
      await waitFor(() => expect(view.queryByTestId('home-message-coach')).toBeNull());
      expect(view.queryByText(/Bradley|coach/i)).toBeNull();
      expect(view.queryByLabelText(/Bradley|coach/i)).toBeNull();
      expect(view.getByTestId('home-leading-empty')).toBeTruthy();
      expect(view.queryByTestId('home-roman-locked-header')).toBeNull(); // still a coached client: never "Opens with a coach"
      expect(view.getByTestId('home-notification-bell')).toBeTruthy();
      if (!rings) expect(view.getByTestId('home-roman-chat')).toBeTruthy(); // Roman's door stays
      closed.now = false;
      await act(async () => { await queryClient.invalidateQueries({ queryKey: COACH_CHAT_KEY }); });
      expect(await view.findByLabelText('Message Bradley')).toBeTruthy();
    });

    it('a failed thread read keeps the last answer: closed stays closed', async () => {
      mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
      serve({ now: true });
      const view = await render(<HomeHeaderActions />);
      await waitFor(() => expect(view.getByTestId('home-leading-empty')).toBeTruthy());
      mockGet.mockImplementation(async (u: string) => {
        if (u === '/messages?limit=1') throw new Error('offline');
        return { data: { name: 'Bradley Gleave' } };
      });
      await act(async () => { await queryClient.invalidateQueries({ queryKey: COACH_CHAT_KEY }); });
      expect(view.queryByTestId('home-message-coach')).toBeNull();
    });
  });

  // FR-880R3 (agent 174): Sol B1 (a cold start loads the block list saved on this phone), Opus C2 (no "Message {coach}"
  // until the answer is known) and Opus C1 (Roman stays beside the bell whether or not the coach entry shows).
  describe('FR-880R3: cold start and a steady header', () => {
    const { queryClient } = jest.requireActual('../../../services/queryClient');
    const { useBlockedUsersStore, persistKeyFor } = jest.requireActual('../../../store/blockedUsersStore');
    const { prefsStorage } = jest.requireActual('../../../storage/mmkv');
    afterEach(async () => {
      queryClient.clear();
      await prefsStorage.delete(persistKeyFor('u1'));
      useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
    });

    it('Sol B1: a fresh launch with my saved block on the phone and a failed thread read never shows the coach', async () => {
      mockRomanChat.mockReturnValue(true);
      mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
      await prefsStorage.set(persistKeyFor('u1'), JSON.stringify([{ id: 'c1', displayName: 'Bradley', role: 'coach', blockedAt: '2026-10-24T00:00:00Z' }]));
      queryClient.clear();
      useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null }); // nothing read yet, as on a cold start
      mockGet.mockImplementation(async (u: string) => {
        if (u === '/messages?limit=1') throw new Error('offline');
        return u === '/messages/unread-count' ? { data: { total: 1 } } : { data: { name: 'Bradley Gleave' } };
      });
      const view = await render(<HomeHeaderActions />);
      expect(view.queryByTestId('home-message-coach')).toBeNull();
      await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach'));
      await waitFor(() => expect(queryClient.getQueryState(['messaging', 'coach-chat-closed', 'c1'])?.status).toBe('error'));
      await waitFor(() => expect(useBlockedUsersStore.getState().hydrated).toBe(true));
      expect(useBlockedUsersStore.getState().blocked.map((b: { id: string }) => b.id)).toEqual(['c1']);
      expect(view.queryByTestId('home-message-coach')).toBeNull();
      expect(view.queryByText(/Bradley|coach/i)).toBeNull();
      expect(view.getByTestId('home-leading-empty')).toBeTruthy();
      expect(view.getByTestId('home-roman-chat')).toBeTruthy(); // Roman's door stays
    });

    it('Opus C2: no "Message {coach}" before the first thread read answers; an open answer brings it in', async () => {
      mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
      let answer: (v: unknown) => void = () => undefined;
      mockGet.mockImplementation((u: string) => {
        if (u === '/messages?limit=1') return new Promise((r) => { answer = r; });
        return Promise.resolve({ data: { name: 'Bradley Gleave' } });
      });
      const view = await render(<HomeHeaderActions />);
      await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/messages?limit=1'));
      await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach'));
      await waitFor(() => expect(useBlockedUsersStore.getState().hydrated).toBe(true));
      expect(view.queryByTestId('home-message-coach')).toBeNull();
      expect(view.queryByText(/Bradley|coach/i)).toBeNull();
      expect(view.getByTestId('home-leading-empty')).toBeTruthy();
      await act(async () => answer({ data: [], headers: {} }));
      expect(await view.findByLabelText('Message Bradley')).toBeTruthy();
    });

    it('Opus C1: Roman keeps one place beside the bell, open or closed', async () => {
      mockRomanChat.mockReturnValue(true);
      mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
      mockGet.mockImplementation(async (u: string) => (u === '/messages?limit=1' ? { data: [], headers: {} } : { data: { name: 'Bradley Gleave' } }));
      const view = await render(<HomeHeaderActions />);
      await view.findByLabelText('Message Bradley');
      const open = StyleSheet.flatten(view.getByTestId('home-roman-chat').props.style);
      expect(open).toMatchObject({ width: 44, height: 44, marginLeft: 'auto', marginRight: 8 });
      await act(async () => useBlockedUsersStore.setState({ blocked: [{ id: 'c1', displayName: 'Bradley', blockedAt: '2026-10-24T00:00:00Z' }] }));
      expect(view.queryByTestId('home-message-coach')).toBeNull();
      expect(StyleSheet.flatten(view.getByTestId('home-roman-chat').props.style)).toEqual(open);
    });
  });

  // C3B-S2: with Style B and Roman chat on, every message entry opens the Messages list (HomeStack MessagesInbox).
  it('Style B on: the coach entry and the Roman avatar both open the Messages list, labels unchanged', async () => {
    mockStyleB.mockReturnValue(true);
    mockRomanChat.mockReturnValue(true);
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockImplementation(async (u: string) =>
      u === '/messages/unread-count' ? { data: { total: 2 } } : { data: { name: 'Bradley Gleave' } },
    );
    const view = await render(<HomeHeaderActions />);
    await fireEvent.press(await view.findByLabelText('Message Bradley, 2 unread'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MessagesInbox');
    await fireEvent.press(view.getByLabelText('Chat with Roman'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MessagesInbox');
    await fireEvent.press(view.getByTestId('home-notification-bell'));
    expect(mockNavigate).toHaveBeenLastCalledWith('NotificationCenter');
    expect(mockNavigate).toHaveBeenCalledTimes(3);
  });

  it('Style B on, no coach: Ask Roman opens the Messages list (its no-coach state)', async () => {
    mockStyleB.mockReturnValue(true);
    mockRomanChat.mockReturnValue(true);
    mockUser.mockReturnValue({ id: 'u1', coach_id: null });
    const view = await render(<HomeHeaderActions />);
    expect(view.getByText('Ask Roman')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Chat with Roman'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MessagesInbox');
  });

  it('Style B on but Roman chat off: no list of one, the coach entry still opens the thread', async () => {
    mockStyleB.mockReturnValue(true);
    mockUser.mockReturnValue({ id: 'u1', coach_id: 'c1' });
    mockGet.mockRejectedValue(new Error('404'));
    const view = await render(<HomeHeaderActions />);
    await fireEvent.press(await view.findByTestId('home-message-coach'));
    expect(mockNavigate).toHaveBeenLastCalledWith('Messages');
    expect(view.queryByTestId('home-roman-chat')).toBeNull();
  });

  it('HomeScreen mounts the actions and the deferred push card; ClientNavigator has no dead headerRight bell', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'screens', 'client', 'HomeScreen.tsx'), 'utf8');
    expect(home).toMatch(/<HomeHeaderActions \/>/);
    expect(home).toMatch(/<PushPermissionCard presentation="section" \/>/);
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
    expect(nav).not.toMatch(/headerRight: \(\) =>/);
  });
});
