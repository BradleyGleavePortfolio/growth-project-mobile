/**
 * SPACE-STATES-M (agent 203; owner #203-E54, 203-D27 op 2: ctx#538 style 2, the Slot band): the space chat's closed
 * and empty states, on the real CommunitySpaceChatScreen at 390 pt and 100% text and at 320 x 568 pt and 130% text.
 *   - Closed (S1 on open, S2 after a refused send): only the header as built, the note "Messages in this space are
 *     hidden." (W9) and the band with the Studio closed bar (CLOSED_LINE, a polite live region) and Back to spaces (W2).
 *     No message, field, mic, chip or start row. A refused send closes the keyboard and says CLOSED_LINE once.
 *   - Empty (S3, S4, S5): "This is the start of {space}." (W10) with the purpose and the member count, only once the
 *     server let this viewer in on this visit and the space has no message. Announcements: the sage band with
 *     "Only your coach posts here." The coach: one suggestion, "Welcome to {space}." (W11), that fills the field and
 *     never sends.
 *   - Back to spaces: the coach's space list on the coach stack; the space drawer on the member stack.
 * Jest lays nothing out: sizes are read from the styles (minWidth / minHeight), and wrapping from the props
 * (no numberOfLines, no allowFontScaling={false}).
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import React from 'react';
import { AccessibilityInfo, Keyboard, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authEvents } from '../../../utils/authEvents';
import { CLOSED_LINE } from '../../../components/messaging/ConversationClosed';

const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communitySpaceChat: true, communityVoiceNotes: true } }));
const mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
const mockParams: { current: Record<string, unknown> } = { current: { cohortId: 'c-crew' } };
const mockNavigate = jest.fn();
const mockStack = { routes: ['CommunityTab', 'CommunitySpaceChat'] };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: jest.fn(), goBack: jest.fn(), getState: () => ({ routeNames: mockStack.routes }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => true,
}));
let mockUser = { id: 'me-1', name: 'Jordan Lee', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useCoachChatClosed', () => ({ useCoachChatClosed: () => ({ known: true, closed: false }) }));
const mockInsets = { top: 47, right: 0, bottom: 34, left: 0 };
jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    SafeAreaInsetsContext: createContext(mockInsets),
    useSafeAreaInsets: () => mockInsets,
  };
});
const mockNet = { isOnline: true };
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: mockNet.isOnline, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
// ctx#538's frames: a fictional "Morning crew", 14 members, and its purpose (index.md :184-186).
const PURPOSE = 'Early sessions, check-ins and form questions.';
let mockRole = 'client';
let mockPurpose: unknown = PURPOSE;
const cohorts = () => [
  { id: 'c-crew', workspace_id: 'ws', name: 'Morning crew', is_default: false, kind: 'default', member_count: 14, my_role: mockRole,
    ...(mockPurpose === undefined ? {} : { description: mockPurpose }) },
  { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 14, my_role: mockRole, description: PURPOSE },
];
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({ data: { feature_flag_state: 'on', cohorts: cohorts() }, isLoading: false, isError: false, refetch: jest.fn() }),
  useCommunityMe: () => ({ dataUpdatedAt: 0, data: undefined, isLoading: false, isError: false }),
  useCommunityWorkspace: () => ({ data: undefined }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../../../components/community/VoiceNotePlayer', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID}>player</Text>;
});
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(), remove: jest.fn() } }));
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => ({ items: [], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() }) }));
jest.mock('../../../components/community/VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID} accessibilityLabel="Report or block">menu</Text>;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen = require('../CommunitySpaceChatScreen').default;

const W9 = 'Messages in this space are hidden.';
const W2 = 'Back to spaces';
const W10 = (space: string) => `This is the start of ${space}.`;
const W11 = (space: string) => `Welcome to ${space}.`;
const HINT = 'Only your coach posts here.';

const msg = (id: string, at: string, who: { id: string; name: string; is_coach?: boolean }, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: String(mockParams.current.cohortId), sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const COACH = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const PRIYA = { id: 'u-2', name: 'Priya Shah' };
const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} });
let page: unknown[] = [];
let readFails: unknown = null;
const sends = () => mockApi.post.mock.calls.filter(([u]) => String(u).endsWith('/messages'));
const asCoach = () => { mockRole = 'owner'; mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' }; };
const coachStack = () => { mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat']; };

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat'];
  mockNavigate.mockReset();
  mockNet.isOnline = true;
  mockRole = 'client';
  mockPurpose = PURPOSE;
  mockUser = { id: 'me-1', name: 'Jordan Lee', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-crew' };
  page = [];
  readFails = null;
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) return { data: { last_read_at: null, last_read_message_id: null } };
    if (url.endsWith('/messages')) {
      if (readFails) throw readFails;
      return { data: { messages: page, next_before: null } };
    }
    if (url === '/community/voice-consent') return { data: { seen: true, seen_at: '2026-10-20T10:00:00.000Z' } };
    return { data: {} };
  });
  mockApi.post.mockReset().mockImplementation(async (url: string) =>
    (url.endsWith('/read') ? { data: { ok: true } } : { data: { message: msg('m9', new Date().toISOString(), { id: mockUser.id, name: mockUser.name }) } }));
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
});

let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><Screen /></QueryClientProvider>;
const open = async (saved?: unknown[]) => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  if (saved) {
    client.setQueryData(['community', 'space-chat', mockUser.id, mockParams.current.cohortId], { pages: [{ messages: saved, next_before: null }], pageParams: [null] });
  }
  const r = await render(tree());
  await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
  return r;
};
type R = Awaited<ReturnType<typeof open>>;
afterEach(() => { client?.clear(); jest.restoreAllMocks(); });

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const atLeast44 = (node: { props: { style?: unknown } }, both = true) => {
  const st = flat(node);
  expect(Number(st.minHeight ?? st.height)).toBeGreaterThanOrEqual(44);
  if (both) expect(Number(st.minWidth ?? st.width)).toBeGreaterThanOrEqual(44);
};
const wraps = (node: { props: Record<string, unknown> }) => {
  expect(node.props.numberOfLines).toBeUndefined();
  expect(node.props.allowFontScaling).not.toBe(false);
  expect(node.props.maxFontSizeMultiplier).toBeUndefined();
};
/** Nothing of the space's content and no way to type: no list, no start row, no field, no mic, no suggestion. */
const nothingOpen = (r: R) => {
  expect(r.queryByTestId('space-chat-list')).toBeNull();
  expect(r.queryByTestId(/^space-chat-row-/)).toBeNull();
  expect(r.queryByTestId('space-chat-start')).toBeNull();
  expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
  expect(r.queryByTestId('space-chat-mic')).toBeNull();
  expect(r.queryByTestId('space-chat-suggestion')).toBeNull();
  expect(r.queryByTestId('space-chat-hint')).toBeNull();
};

describe.each([
  ['390 pt at 100%', { width: 390, height: 844, fontScale: 1 }],
  ['320 x 568 pt at 130%', { width: 320, height: 568, fontScale: 1.3 }],
])('space chat states at %s', (_size, dims) => {
  beforeEach(() => { Object.assign(mockWindow, dims); });

  it('S1: a space closed on open (404): the note, the closed bar and Back to spaces; nothing else; the header as built', async () => {
    mockParams.current = { cohortId: 'c-gone' }; // a closed space is not in the cohort list: the header is blank (index.md :70-74)
    readFails = fail(404);
    const r = await open();
    const bar = await r.findByTestId('space-chat-no-access');
    expect(bar.props.accessibilityLiveRegion).toBe('polite');
    expect(bar.props.accessibilityLabel).toBe(CLOSED_LINE);
    expect(within(bar).getByText(CLOSED_LINE)).toBeTruthy();
    expect(r.getByText(W9)).toBeTruthy();
    const back = r.getByRole('button', { name: W2 });
    atLeast44(back);
    nothingOpen(r);
    expect(r.queryByText(/No messages yet/)).toBeNull();
    expect(r.queryByTestId('space-chat-info')).toBeNull();
    expect(r.queryByTestId('space-chat-hash')).toBeNull();
    expect(r.queryByText(/members$/)).toBeNull();
  });

  it('S2: a send refused with 404 while typing: rows, field and mic go; the keyboard closes and the line is said once', async () => {
    page = [msg('m2', '2026-10-22T06:55:00.000Z', PRIYA), msg('m1', '2026-10-22T06:48:00.000Z', COACH)];
    mockApi.post.mockImplementation(async (url: string) => { if (url.endsWith('/messages')) throw fail(404); return { data: { ok: true } }; });
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const say = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const r = await open();
    await r.findByTestId('space-chat-row-m2');
    const field = r.getByTestId('space-chat-composer-field');
    await fireEvent(field, 'focus');
    await fireEvent.changeText(field, 'I can bring water for everyone');
    await fireEvent.press(r.getByTestId('space-chat-composer-send'));
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    nothingOpen(r);
    expect(r.getByText(W9)).toBeTruthy();
    expect(r.getByRole('button', { name: W2 })).toBeTruthy();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(CLOSED_LINE);
    await r.rerender(tree());
    await act(async () => { await client.invalidateQueries(); });
    expect(say).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(r.getByText('Morning crew')).toBeTruthy(); // the header keeps the space's name (S2b)
  });

  it('S1 on open says nothing itself and closes no keyboard (the bar is a polite region)', async () => {
    readFails = fail(403);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const say = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const r = await open();
    await r.findByTestId('space-chat-no-access');
    expect(dismiss).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  it('H1: a closed answer with rows restored from the saved cache draws none of them, and no start row before the answer', async () => {
    let answer: (e: unknown) => void = () => undefined;
    mockApi.get.mockImplementation((url: string) => (url.endsWith('/messages')
      ? new Promise((_res, rej) => { answer = rej; })
      : Promise.resolve({ data: { last_read_at: null, last_read_message_id: null } })));
    const r = await open([msg('m1', '2026-10-22T06:48:00.000Z', PRIYA)]);
    expect(await r.findByTestId('space-chat-row-m1')).toBeTruthy(); // the saved page, read only, until the server answers
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    expect(r.queryByTestId('space-chat-start')).toBeNull();
    await act(async () => { answer(fail(403)); });
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    nothingOpen(r);
  });

  it('no start row and no suggestion while loading', async () => {
    asCoach();
    mockApi.get.mockImplementation(() => new Promise(() => undefined));
    const r = await open();
    expect(r.getByTestId('space-chat-loading')).toBeTruthy();
    nothingOpen(r);
  });

  it('no start row and no suggestion on a saved empty page before the server answered on this visit (cold start)', async () => {
    asCoach();
    mockApi.get.mockImplementation((url: string) => (url.endsWith('/messages')
      ? new Promise(() => undefined) : Promise.resolve({ data: { last_read_at: null, last_read_message_id: null } })));
    const r = await open([]);
    await act(async () => undefined);
    nothingOpen(r);
    mockNet.isOnline = false;
    await r.rerender(tree());
    nothingOpen(r);
  });

  it('offline with nothing saved: the error state, no start row, no suggestion', async () => {
    asCoach();
    mockNet.isOnline = false;
    mockApi.get.mockImplementation(async () => { throw offline(); });
    const r = await open();
    expect(await r.findByTestId('space-chat-error')).toBeTruthy();
    nothingOpen(r);
  });

  it('a space holding only a row the coach removed is not empty: no start row, no suggestion', async () => {
    asCoach();
    page = [msg('rt', '2026-10-22T09:40:00.000Z', PRIYA, { deleted: true, body: null, removed_at: '2026-10-22T11:00:00.000Z', removed_by: { role: 'coach', user_id: 'coach-1', name: 'Sam Okafor' } })];
    const r = await open();
    await r.findByTestId('space-chat-list');
    expect(r.queryByTestId('space-chat-start')).toBeNull();
    expect(r.queryByTestId('space-chat-suggestion')).toBeNull();
  });

  it('S3: a member who can post, no messages: the start row with the purpose and count, the field and mic, no suggestion', async () => {
    const r = await open();
    const start = await r.findByTestId('space-chat-start');
    expect(r.getByTestId('space-chat-empty')).toBeTruthy();
    const title = within(start).getByText(W10('Morning crew'));
    expect(title.props.accessibilityRole).toBe('header');
    const purpose = within(start).getByText(PURPOSE);
    expect(within(start).getByText('14 members')).toBeTruthy();
    const tile = within(start).getByTestId('space-chat-start-tile', { includeHiddenElements: true });
    expect(tile.props.accessibilityElementsHidden).toBe(true);
    expect(tile.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(within(tile).getByTestId('space-chat-start-hash', { includeHiddenElements: true })).toBeTruthy();
    expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
    expect(r.getByTestId('space-chat-mic')).toBeTruthy();
    expect(r.queryByTestId('space-chat-suggestion')).toBeNull();
    expect(r.queryByTestId('space-chat-hint')).toBeNull();
    expect(r.queryByText(/No messages yet/)).toBeNull();
    wraps(title);
    wraps(purpose);
  });

  it.each([['null', null], ['absent', undefined], ['blank', '   ']])('S3: a purpose that is %s draws no purpose line', async (_k, value) => {
    mockPurpose = value;
    const r = await open();
    const start = await r.findByTestId('space-chat-start');
    expect(within(start).queryByTestId('space-chat-start-purpose')).toBeNull();
    expect(within(start).queryByText(/null|undefined/)).toBeNull();
    expect(within(start).getByText('14 members')).toBeTruthy();
  });

  it('S4: Announcements, a member: the start row with the megaphone, the sage band with the hint, no field', async () => {
    mockParams.current = { cohortId: 'c-ann' };
    const r = await open();
    const start = await r.findByTestId('space-chat-start');
    expect(within(start).getByText(W10('Announcements'))).toBeTruthy();
    expect(within(start).getByTestId('space-chat-start-megaphone', { includeHiddenElements: true })).toBeTruthy();
    const band = r.getByTestId('space-chat-hint');
    const words = within(band).getByText(HINT);
    wraps(words);
    expect(flat(band).backgroundColor).toBe(jest.requireActual('../../../theme/tokens').forestPop.sage);
    expect(r.queryByTestId('space-chat-composer-field')).toBeNull();
    expect(r.queryByTestId('space-chat-suggestion')).toBeNull();
  });

  it('S4: a member answering the coach in Announcements gets the field and no band', async () => {
    mockParams.current = { cohortId: 'c-ann' };
    page = [msg('m1', '2026-10-22T06:48:00.000Z', COACH)];
    const r = await open();
    await r.findByTestId('space-chat-row-m1');
    expect(r.getByTestId('space-chat-hint')).toBeTruthy(); // the band wherever the hint shows, rows or none
    await fireEvent(r.getByTestId('space-chat-row-m1'), 'longPress');
    // The sheet row, then the Modal's onDismiss (the jest Modal never calls it): iOS runs the row's action there.
    let node = r.getByTestId('space-chat-sheet') as unknown as { props: Record<string, unknown>; parent: unknown } | null;
    while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
    const dismissed = node?.props.onDismiss as (() => void) | undefined;
    await fireEvent.press(r.getByTestId('space-chat-sheet-reply'));
    await act(async () => { dismissed?.(); });
    await waitFor(() => expect(r.getByTestId('space-chat-composer-field')).toBeTruthy());
    expect(r.queryByTestId('space-chat-hint')).toBeNull();
  });

  it('S4: the coach in an empty Announcements space: the field and the suggestion, no band', async () => {
    asCoach();
    mockParams.current = { cohortId: 'c-ann' };
    const r = await open();
    await r.findByTestId('space-chat-start');
    expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
    expect(r.getByRole('button', { name: W11('Announcements') })).toBeTruthy();
    expect(r.queryByTestId('space-chat-hint')).toBeNull();
  });

  it('S5: the coach: one suggestion that fills the field, never sends, and hides once there is text or a message', async () => {
    asCoach();
    const r = await open();
    await r.findByTestId('space-chat-start');
    const chip = r.getByRole('button', { name: W11('Morning crew') });
    expect(r.getByTestId('space-chat-suggestion')).toBe(chip);
    atLeast44(chip, false);
    wraps(within(chip).getByText(W11('Morning crew')));
    await fireEvent.press(chip);
    expect(r.getByTestId('space-chat-composer-field').props.value).toBe(W11('Morning crew'));
    expect(sends()).toHaveLength(0);
    expect(r.queryByTestId('space-chat-suggestion')).toBeNull();
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), '');
    expect(r.getByTestId('space-chat-suggestion')).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Morning all');
    expect(r.queryByTestId('space-chat-suggestion')).toBeNull();
    await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
    expect(sends()).toHaveLength(0);
  });

  it('S5: no suggestion once the space has a message, and none for a member', async () => {
    asCoach();
    page = [msg('m1', '2026-10-22T06:48:00.000Z', PRIYA)];
    const a = await open();
    await a.findByTestId('space-chat-row-m1');
    expect(a.queryByTestId('space-chat-suggestion')).toBeNull();
    await a.unmount();
    mockRole = 'client';
    mockUser = { id: 'me-1', name: 'Jordan Lee', coach_id: 'coach-1' };
    page = [];
    const b = await open();
    await b.findByTestId('space-chat-start');
    expect(b.queryByTestId('space-chat-suggestion')).toBeNull();
  });

  it('Back to spaces on the coach stack opens the coach\'s space list', async () => {
    asCoach();
    coachStack();
    readFails = fail(404);
    const r = await open();
    await r.findByTestId('space-chat-no-access');
    const back = r.getByRole('button', { name: W2 });
    atLeast44(back);
    await fireEvent.press(back);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('CoachCommunityCohorts');
  });

  it('Back to spaces on the member stack opens the space drawer', async () => {
    readFails = fail(404);
    const r = await open();
    await r.findByTestId('space-chat-no-access');
    expect(r.queryByTestId('space-list')).toBeNull();
    await fireEvent.press(r.getByRole('button', { name: W2 }));
    expect(await r.findByTestId('space-list')).toBeTruthy();
    expect(r.getByTestId('space-list-jump')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('the closed note and band wrap at any size: no line limit, text scales, every control at least 44 pt', async () => {
    readFails = fail(404);
    const r = await open();
    const bar = await r.findByTestId('space-chat-no-access');
    wraps(r.getByText(W9));
    wraps(within(bar).getByText(CLOSED_LINE));
    const back = r.getByRole('button', { name: W2 });
    atLeast44(back);
    wraps(within(back).getByText(W2));
  });
});

// The colour guard: every product file this round changes takes its colours from tokens (no hex, rgb( or rgba( in code;
// comments are left out, where owner ids such as #169-5 live).
const CHANGED = [
  'screens/community/CommunitySpaceChatScreen.tsx',
  'components/community/space-chat/SpaceStartRow.tsx',
  'components/community/space-chat/SpaceChatComposer.tsx',
  'components/community/SpaceDrawer.tsx',
  'components/messaging/ConversationClosed.tsx',
];
const codeOnly = (file: string) => {
  const text = fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  return ts.createPrinter({ removeComments: true }).printFile(source);
};
it.each(CHANGED)('%s: no colour literal in its code', (file) => {
  expect(fs.existsSync(path.join(__dirname, '../../..', file))).toBe(true);
  const code = codeOnly(file);
  expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(code).not.toMatch(/\brgba?\(/);
});
