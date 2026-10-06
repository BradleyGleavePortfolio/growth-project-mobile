/**
 * Coach one inbox (messaging v2): server order is kept (pinned first),
 * previews say what the last message was, the Unread switch is a server
 * filter, long-press pins / mutes the conversation with the documented
 * routes, limit errors show their own copy, clients without messages stay
 * reachable, and a 503 feature_disabled hands back to the legacy list.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
  ThemeColors: {},
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../tutorial/tutorialEvents', () => ({ emitTutorialSignal: jest.fn() }));
const mockSubscribe = jest.fn((..._args: unknown[]) => () => undefined);
jest.mock('../../../services/realtime', () => ({
  subscribeToMessages: (...args: unknown[]) => mockSubscribe(...args),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
const mockClients = [
  { id: 'client-1', firstName: 'Ana', lastName: 'Ruiz', status: 'active' },
  { id: 'client-2', firstName: 'Ben', lastName: 'Ode', status: 'active' },
  { id: 'client-3', firstName: 'Cy', lastName: 'Lowe', status: 'active' },
  { id: 'client-4', firstName: 'Old', lastName: 'Client', status: 'archived' },
];
jest.mock('../../../store/coachStore', () => ({
  useCoachStore: () => ({ clients: mockClients, loadClients: jest.fn() }),
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const R = jest.requireActual('react');
      R.useEffect(() => cb(), [cb]);
    },
  };
});

import api from '../../../services/api';
import CoachInboxV2, { inboxPreview, inboxTimeLabel } from '../CoachInboxV2';
import type { InboxThread } from '../../../api/messagingV2Api';

const http = api as unknown as Record<'get' | 'put', jest.Mock>;

function thread(over: Partial<InboxThread> & { client_id: string; name: string }): InboxThread {
  const { name, ...rest } = over;
  return {
    thread_id: `coach-1:${over.client_id}`,
    kind: 'coach_client',
    coach_id: 'coach-1',
    counterpart: { user_id: over.client_id, display_name: name },
    last_message: {
      id: `m-${over.client_id}`,
      sender_id: over.client_id,
      is_mine: false,
      kind: 'text',
      preview: 'See you Monday',
      created_at: '2026-10-05T10:00:00.000Z',
      edited: false,
    },
    unread_count: 0,
    muted: false,
    muted_until: null,
    pinned: false,
    blocked_by_me: false,
    last_activity_at: '2026-10-05T10:00:00.000Z',
    ...rest,
  };
}

const pinnedBen = thread({ client_id: 'client-2', name: 'Ben Ode', pinned: true, unread_count: 3 });
const mutedAna = thread({
  client_id: 'client-1',
  name: 'Ana Ruiz',
  muted: true,
  last_message: {
    id: 'm-a',
    sender_id: 'coach-1',
    is_mine: true,
    kind: 'deleted',
    preview: '',
    created_at: '2026-10-05T09:00:00.000Z',
    edited: false,
  },
});

function page(items: InboxThread[], next: string | null = null, total = 3) {
  return { data: { items, next_cursor: next, total_unread: total } };
}

function renderInbox(onFeatureDisabled = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <CoachInboxV2 onFeatureDisabled={onFeatureDisabled} />
    </QueryClientProvider>,
  );
}

const originalOS = Platform.OS;
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});
beforeEach(() => {
  jest.clearAllMocks();
  http.get.mockReset();
  http.put.mockReset();
});

describe('row copy', () => {
  it('previews say deleted, voice, own and blocked truthfully', () => {
    expect(inboxPreview(mutedAna)).toBe('You: Message deleted');
    expect(
      inboxPreview(thread({ client_id: 'x', name: 'X', last_message: { ...pinnedBen.last_message!, kind: 'voice', preview: '' } })),
    ).toBe('Voice note');
    expect(inboxPreview(thread({ client_id: 'x', name: 'X', blocked_by_me: true }))).toBe('Blocked');
    expect(inboxPreview(thread({ client_id: 'x', name: 'X', last_message: null }))).toBe('No messages yet');
    expect(inboxPreview(pinnedBen)).toBe('See you Monday');
  });

  it('time label: today as a time, this week as a weekday, older as a date', () => {
    const now = new Date('2026-10-05T18:00:00.000Z');
    expect(inboxTimeLabel(null, now)).toBe('');
    expect(inboxTimeLabel('2026-10-02T12:00:00.000Z', now)).toMatch(/^[A-Z][a-z]{2}$/);
    expect(inboxTimeLabel('2026-09-01T12:00:00.000Z', now)).toMatch(/Sep/);
  });
});

describe('CoachInboxV2', () => {
  it('keeps the server order, shows markers and appends active clients without messages', async () => {
    http.get.mockResolvedValue(page([pinnedBen, mutedAna]));
    const utils = await renderInbox();
    await utils.findByText('Ben Ode');
    expect(http.get.mock.calls[0][0]).toBe('/coach/messages/inbox?limit=50');
    const labels = utils
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel as string)
      .filter((l) => /messages with|conversation with/.test(l));
    expect(labels).toEqual([
      'Open messages with Ben Ode, pinned, 3 unread',
      'Open messages with Ana Ruiz, muted',
      'Start a conversation with Cy Lowe',
    ]);
    expect(utils.getByText('You: Message deleted')).toBeTruthy();
    expect(utils.getByText('3 unread messages')).toBeTruthy();
    expect(utils.queryByText('Old Client')).toBeNull();
    expect(mockSubscribe).toHaveBeenCalledWith('coach-1', expect.any(Function), expect.any(Function));
  });

  it('Unread is a server filter and does not list clients without messages', async () => {
    http.get.mockResolvedValue(page([pinnedBen]));
    const utils = await renderInbox();
    await utils.findByText('Ben Ode');
    await fireEvent.press(utils.getByLabelText('Unread conversations'));
    await waitFor(() => expect(http.get).toHaveBeenLastCalledWith('/coach/messages/inbox?limit=50&filter=unread', expect.anything()));
    expect(utils.queryByText('Cy Lowe')).toBeNull();
  });

  it('opens the thread on tap', async () => {
    http.get.mockResolvedValue(page([pinnedBen]));
    const utils = await renderInbox();
    await fireEvent.press(await utils.findByTestId('inbox-row-client-2'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', {
      screen: 'ClientMessages',
      params: { clientId: 'client-2', clientName: 'Ben Ode' },
    });
  });

  it('long-press unpins a pinned conversation and mutes with the chosen duration', async () => {
    http.get.mockResolvedValue(page([pinnedBen, mutedAna]));
    http.put.mockResolvedValue({ data: { muted: false, muted_until: null, pinned: false } });
    const utils = await renderInbox();
    await fireEvent(await utils.findByTestId('inbox-row-client-2'), 'longPress');
    await fireEvent.press(utils.getByLabelText('Unpin conversation'));
    await waitFor(() =>
      expect(http.put).toHaveBeenCalledWith('/coach/clients/client-2/messages/inbox-pin', { pinned: false }, expect.anything()),
    );

    await fireEvent(utils.getByTestId('inbox-row-client-1'), 'longPress');
    expect(utils.getByLabelText('Unmute')).toBeTruthy();
    await fireEvent.press(utils.getByLabelText('Mute for 8 hours'));
    await waitFor(() =>
      expect(http.put).toHaveBeenCalledWith('/coach/clients/client-1/messages/mute', { duration: '8h' }, expect.anything()),
    );
  });

  it('shows the inbox pin limit copy when a sixth pin is refused', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    http.get.mockResolvedValue(page([mutedAna]));
    http.put.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { code: 'messaging.inbox_pin_limit_reached', error: 'messaging.inbox_pin_limit_reached' } },
    });
    const utils = await renderInbox();
    await fireEvent(await utils.findByTestId('inbox-row-client-1'), 'longPress');
    await fireEvent.press(utils.getByLabelText('Pin conversation'));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'Conversation not updated',
        'Up to 5 conversations can be pinned. Unpin one to pin this conversation.',
      ),
    );
    alert.mockRestore();
  });

  it('search pages through the rest of the inbox before saying nothing matched', async () => {
    http.get
      .mockResolvedValueOnce(page([pinnedBen], 'cursor-2'))
      .mockResolvedValueOnce(page([mutedAna], null));
    const utils = await renderInbox();
    await utils.findByText('Ben Ode');
    await fireEvent.changeText(utils.getByLabelText('Search conversations'), 'ana');
    expect(await utils.findByText('Ana Ruiz')).toBeTruthy();
    expect(http.get).toHaveBeenCalledWith('/coach/messages/inbox?cursor=cursor-2&limit=50', expect.anything());
    expect(utils.queryByText('Ben Ode')).toBeNull();
  });

  it('a 503 feature_disabled hands back to the legacy list', async () => {
    const onFeatureDisabled = jest.fn();
    http.get.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: { code: 'messaging.feature_disabled', error: 'messaging.feature_disabled' } },
    });
    await renderInbox(onFeatureDisabled);
    await waitFor(() => expect(onFeatureDisabled).toHaveBeenCalled());
  });

  it('a failed load says what happened and offers a retry', async () => {
    http.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: {} } });
    const utils = await renderInbox();
    expect(await utils.findByText('Inbox did not load')).toBeTruthy();
    expect(utils.getByText('The server could not finish this action. Try again in a moment.')).toBeTruthy();
    http.get.mockResolvedValue(page([pinnedBen]));
    await fireEvent.press(utils.getByLabelText('Try again'));
    expect(await utils.findByText('Ben Ode')).toBeTruthy();
  });
});
