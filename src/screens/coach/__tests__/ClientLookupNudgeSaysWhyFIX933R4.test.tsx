/**
 * FIX-933R4 (LS-933R4 B1, class-first [R24], owner 199-D11 op 1): one table over every place the lookup's nudge hook
 * closes or resets its form, from every Nudge entry (the Needs you row's Nudge, the search row's bell, the peek's Send
 * nudge): a send refused as closed (every closed answer, both block directions), a block either way landing while the
 * form is up, the pair going unread, and a send's answer landing after the coach pressed again, cancelled, reopened or
 * moved to another client's form. From a row, the form says why at once (the chat's closed line where its words and
 * Send were, announced) and keeps the draft; from the peek, the form goes and the peek's line says it. Every other
 * refusal keeps today's error, the form, its words and Send. Real lookup, peek, nudge hook, NudgeModal and chat gate;
 * only the network (and the stores it fills) is faked.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { closedRefusals } from '../../../components/messaging/closedRefusal';
import { BLOCKED_BY_ME_LINE, blockedYouLine } from '../../../components/messaging/ConversationClosed';
import { errorMessage } from '../../../types/common';

const mockNavigate = jest.fn();
const mockSend = jest.fn(async (..._args: unknown[]): Promise<unknown> => ({}));
const mockFocus: Array<() => void> = [];
const quiet = { status: 'active', createdAt: '2026-08-14T10:00:00.000Z', activity: { lastActiveOn: '2026-10-20', checkInsToReview: 0 } };
const jordan = { id: 'c1', firstName: 'Jordan', lastName: 'Reyes', ...quiet };
const casey = { id: 'c2', firstName: 'Casey', lastName: 'Lin', ...quiet };
// Fifteen clients turn the lookup search-first, where each result row carries its own bell.
const others = Array.from({ length: 14 }, (_, i) => ({ ...jordan, id: `o${i}`, firstName: 'Sam', lastName: `Other${i}` }));
const mockUnread = jest.fn();
const mockCache = new Map<string, string>();
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-r4', role: 'coach' }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async () => ({ data: { users: [] } }) },
  coachApi: {
    getUnreadCounts: () => mockUnread(),
    getClients: async () => ({ data: [] }),
    getClientSummary: async () => ({ data: {} }),
    getClientCheckIns: async () => ({ data: [] }),
    getClientWeek: async () => ({ data: { week_start: '2026-11-02', today: '2026-11-05', assignments: [] } }),
    sendNudge: (...args: unknown[]) => mockSend(...args),
  },
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getStringAsync: async (key: string) => mockCache.get(key),
    set: async (key: string, value: string) => void mockCache.set(key, value),
  },
  prefsStorage: { getString: () => undefined },
}));
jest.mock('../../../hooks/useMacros', () => ({
  useMacros: () => ({ formatWeight: (value: number) => `${value} lb` }),
  useCurrentMacrosForClient: () => ({ isSuccess: true, data: null }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
// The coach's block list, read from the real store the chat gate reads, so a block can land while the form is up.
jest.mock('../home-v11/blockList', () => {
  const { useMemo } = jest.requireActual('react');
  const { useBlockedUsersStore: store } = jest.requireActual('../../../store/blockedUsersStore');
  return {
    ...jest.requireActual('../home-v11/blockList'),
    useCoachBlockList: () => {
      const blocked: Array<{ id: string }> = store((s: { blocked: Array<{ id: string }> }) => s.blocked);
      const known: boolean = store((s: { hydrated: boolean }) => s.hydrated);
      return { known, blockedIds: useMemo(() => blocked.map((b) => b.id), [blocked]) };
    },
  };
});
jest.mock('../home-v11/DraftSheets', () => ({ HomeSheet: () => null }));
jest.mock('../../../theme/ThemeProvider', () => {
  const flat = new Proxy({}, { get: () => '#000000' });
  const colors = new Proxy({}, { get: (_t, key) => key === 'surface' || key === 'data' ? flat : '#000000' });
  return { useTheme: () => ({ colors, semanticColors: colors }) };
});
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: {
  selection: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn(),
} }));
jest.mock('../../../ui', () => ({
  Overline: jest.requireActual('react-native').Text,
  useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../ui/states/QuietStates', () => ({ QuietLoading: () => null, QuietError: () => null }));
jest.mock('../../../ui/empty-states', () => ({ EmptyStateNoResults: () => null }));
jest.mock('../../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../../navigation/coachLanding', () => ({ coachLandingTab: () => 'ClientsStack' }));

const nav = {
  navigate: mockNavigate, setParams: jest.fn(), isFocused: () => true,
  addListener: (event: string, cb: () => void) => {
    if (event !== 'focus') return () => undefined;
    mockFocus.push(cb);
    return () => { const i = mockFocus.indexOf(cb); if (i >= 0) mockFocus.splice(i, 1); };
  },
  getParent: () => ({ navigate: mockNavigate, addListener: () => () => undefined }),
} as never;
const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);

const OPEN = { data: { total: 0, by_client: {}, closed_client_ids: [] } };
const CLOSED = { data: { total: 0, by_client: {}, closed_client_ids: ['c1'] } };
const ME_BLOCK = { id: 'c1', displayName: 'Jordan Reyes', role: 'client', blockedAt: '2026-11-06T00:00:00.000Z' };
const TITLE = 'Check in';
const BODY = 'How are you doing?';
const THEM_LINE = blockedYouLine('Jordan Reyes');
const refusal = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

/** Every answer the app reads as "closed" for a send (isClosedRefusal): the nudge's own 403 messaging.blocked (b
 * nudges.service, assertPairOpen: a block either way, no side), and the two other 403 block shapes. */
const CLOSED_ANSWERS = {
  '403 messaging.blocked': refusal(403, { code: 'messaging.blocked', error: 'messaging.blocked', message: 'This conversation is blocked.' }),
  '403 BLOCKED': refusal(403, { error: 'BLOCKED' }),
  '403 coaching blocked text': refusal(403, { message: 'Messages cannot be sent to blocked users' }),
} as const;
/** Both block directions. The server's answer has no side; the coach's own block reaches this phone through its block
 * list (here while the send is in flight), and then the line is the coach's own. */
const DIRECTIONS = {
  'the client blocked the coach': { line: THEM_LINE, land: () => undefined },
  'the coach blocked the client on another device': { line: BLOCKED_BY_ME_LINE, land: () => useBlockedUsersStore.setState({ blocked: [ME_BLOCK] as never }) },
} as const;
/** Every other refusal: not closed, so today's error (errorMessage, fallback "Failed to send nudge."), form and words. */
const OTHER_REFUSALS = {
  offline: Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }),
  'timed out': Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }),
  '500': refusal(500, {}),
  '429': refusal(429, { message: 'Too many requests' }),
  '403 not a block': refusal(403, { message: 'Forbidden resource' }),
  'no reason given': { response: { status: 409, data: {} } },
} as const;

type View = Awaited<ReturnType<typeof render>>;
/** Each Nudge entry on the lookup, reached the way a coach reaches it; returns false when the entry is not drawn. */
const ENTRIES: Record<string, { many: boolean; row: boolean; tap: (v: View, id?: string) => Promise<boolean> }> = {
  'Needs you Nudge': { many: false, row: true, tap: async (v, id = 'c1') => {
    const b = v.queryByTestId(`lookup-act-${id}`); if (b) await fireEvent.press(b); return !!b;
  } },
  'search row bell': { many: true, row: true, tap: async (v) => {
    await fireEvent.changeText(v.getByTestId('lookup-search'), 'jordan');
    const b = v.queryByTestId('lookup-nudge-c1'); if (b) await fireEvent.press(b); return !!b;
  } },
  'peek Send nudge': { many: false, row: false, tap: async (v) => {
    if (!v.queryByTestId('peek-nudge')) {
      await fireEvent.press(v.getByTestId('lookup-row-c1'));
      await waitFor(() => expect(v.getByTestId('peek-chip-Full profile')).toBeTruthy());
    }
    const b = v.queryByTestId('peek-nudge'); if (b) await fireEvent.press(b); return !!b;
  } },
};

async function mount(many: boolean, list = many ? [jordan, ...others] : [jordan]) {
  useCoachStore.setState({
    clients: list as never, filterStatus: 'active', isLoading: false, loadError: null, loadClients: jest.fn(async () => undefined),
  });
  mockUnread.mockResolvedValue(OPEN);
  const view = await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(view.queryByTestId(many ? 'lookup-az-c1' : 'lookup-row-c1')).toBeTruthy());
  await act(async () => undefined);
  return view;
}
async function write(view: View, title = TITLE, body = BODY) {
  await fireEvent.changeText(view.getByLabelText('Nudge title'), title);
  await fireEvent.changeText(view.getByLabelText('Nudge message'), body);
}
/** The lookup reads its lists again (a focus after the first), as on coming back to it. */
async function reread(answer: unknown) {
  mockUnread.mockResolvedValue(answer);
  await act(async () => { mockFocus.at(-1)?.(); mockFocus.at(-1)?.(); });
  await act(async () => undefined);
}
/** The pair opens again (unblocked, the server's list open), as after an unblock on another device. */
async function reopen() {
  await act(async () => { useBlockedUsersStore.setState({ blocked: [] }); closedRefusals.clear('c1'); });
  await reread(OPEN);
}
const realTimers: { setImmediate: (fn: () => void) => void } = jest.requireActual('timers');
/** Press a button whose send is held open on purpose (as DataExportScreen.test's pressHeld): fireEvent.press resolves
 * with the handler's own promise, so it is not awaited; this waits only until its act() scope has closed. */
async function pressHeld(el: Parameters<typeof fireEvent.press>[0]) {
  void fireEvent.press(el);
  for (let i = 0; i < 3; i += 1) await new Promise<void>((r) => realTimers.setImmediate(r));
}
/** A button's own onPress, found as fireEvent finds it (the host element, then its composite owners). */
function onPressOf(el: unknown): () => unknown {
  type Fiber = { memoizedProps?: Record<string, unknown> | null; return: Fiber | null; type: unknown };
  for (let n = el as { parent: unknown; unstable_fiber?: Fiber } | null; n; n = n.parent as typeof n) {
    for (let f = n.unstable_fiber ?? null; f?.memoizedProps; f = f.return) {
      const press = f.memoizedProps.onPress;
      if (typeof press === 'function') return press as () => unknown;
      if (!f.return || typeof f.return.type === 'string') break;
    }
  }
  throw new Error('no onPress');
}
function deferred() {
  let settle: { resolve: (v: unknown) => void; reject: (e: unknown) => void } = { resolve: () => undefined, reject: () => undefined };
  mockSend.mockImplementationOnce(() => new Promise((resolve, reject) => { settle = { resolve, reject }; }));
  return { resolve: (v: unknown) => act(async () => settle.resolve(v)), reject: (e: unknown) => act(async () => settle.reject(e)) };
}
/** The form says why: the line where its words and Send were; Cancel stays. */
function expectSaysWhy(view: View, line: string) {
  expect(view.queryByLabelText('Nudge message')).toBeNull();
  expect(view.queryByLabelText('Nudge title')).toBeNull();
  expect(view.queryByText('Send')).toBeNull();
  expect(view.getByTestId('lookup-nudge-closed').props.accessibilityLabel).toBe(line);
  expect(view.getByText(line)).toBeTruthy(); // one line on screen, the form's
  expect(view.getByLabelText('Cancel')).toBeTruthy();
}
/** From the peek: the form went, and the peek's own line says why (one line on screen). */
function expectPeekSaysWhy(view: View, line: string) {
  expect(view.queryByLabelText('Nudge message')).toBeNull();
  expect(view.queryByTestId('lookup-nudge-closed')).toBeNull();
  expect(view.queryByTestId('peek-nudge')).toBeNull();
  expect(view.getByText(line)).toBeTruthy();
}
function expectEditor(view: View, title = TITLE, body = BODY) {
  expect(view.getByLabelText('Nudge title').props.value).toBe(title);
  expect(view.getByLabelText('Nudge message').props.value).toBe(body);
  expect(view.getByText('Send')).toBeTruthy();
  expect(view.queryByTestId('lookup-nudge-closed')).toBeNull();
}
/** Cancel (a row's form) or close the peek, open the pair again, take the same entry: the coach's words are there. */
async function expectDraftKept(view: View, entry: string) {
  if (ENTRIES[entry].row) await fireEvent.press(view.getByLabelText('Cancel'));
  else await fireEvent.press(view.getByTestId('peek-close'));
  await act(async () => undefined);
  expect(view.queryByTestId('lookup-nudge-closed')).toBeNull();
  await reopen();
  expect(await ENTRIES[entry].tap(view)).toBe(true);
  expectEditor(view);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCache.clear();
  mockFocus.length = 0;
  ['c1', 'c2'].forEach((id) => closedRefusals.clear(id));
  useBlockedUsersStore.setState({ blocked: [], hydrated: true, userId: 'coach-r4' });
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe.each(Object.keys(ENTRIES))('%s', (entry) => {
  const { many, row, tap } = ENTRIES[entry];
  const ROWS = (Object.keys(DIRECTIONS) as Array<keyof typeof DIRECTIONS>).flatMap((d) =>
    (Object.keys(CLOSED_ANSWERS) as Array<keyof typeof CLOSED_ANSWERS>).map((k) => [d, k] as const));

  // The send's answer: refused as closed.
  it.each(ROWS)('%s, %s: says why at once (no extra tap), announced, remembered; the draft is kept', async (dir, kind) => {
    const { line, land } = DIRECTIONS[dir];
    const view = await mount(many);
    expect(await tap(view)).toBe(true);
    await write(view);
    mockSend.mockImplementationOnce(async () => { land(); throw CLOSED_ANSWERS[kind]; });
    await fireEvent.press(view.getByText('Send'));
    await act(async () => undefined);
    if (row) expectSaysWhy(view, line); else expectPeekSaysWhy(view, line);
    expect(closedRefusals.has('c1')).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    if (dir === 'the client blocked the coach') expect(announce).toHaveBeenCalledWith(line);
    await expectDraftKept(view, entry);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  // The pair closes under the open form, before any Send.
  it.each([
    ['the coach blocked the client (their block list)', BLOCKED_BY_ME_LINE, () => act(async () => { useBlockedUsersStore.setState({ blocked: [ME_BLOCK] as never }); })],
    ['the server says the pair is closed (a re-read)', THEM_LINE, () => reread(CLOSED)],
  ] as const)('a block landing while the form is up, %s: says why at once and keeps the draft', async (_how, line, land) => {
    const view = await mount(many);
    expect(await tap(view)).toBe(true);
    await write(view);
    await land();
    if (row) {
      expectSaysWhy(view, line);
      await reopen(); // the pair opens again under the still-open form: the coach's words come back, no extra tap
      expectEditor(view);
    } else {
      expectPeekSaysWhy(view, line);
      await expectDraftKept(view, entry);
    }
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('the pair going unread under the form: the form goes (nothing to say yet), the words stay', async () => {
    const view = await mount(many);
    expect(await tap(view)).toBe(true);
    await write(view);
    await act(async () => { useBlockedUsersStore.setState({ hydrated: false }); });
    expect(view.queryByLabelText('Nudge message')).toBeNull();
    expect(view.queryByTestId('lookup-nudge-closed')).toBeNull();
    await act(async () => { useBlockedUsersStore.setState({ hydrated: true }); });
    expect(await tap(view)).toBe(true);
    expectEditor(view);
  });

  // Every other refusal: today's error, the form, its words and Send.
  it.each(Object.keys(OTHER_REFUSALS) as Array<keyof typeof OTHER_REFUSALS>)('%s: keeps today\'s error, the form, its words and Send', async (kind) => {
    const err = OTHER_REFUSALS[kind];
    const view = await mount(many);
    expect(await tap(view)).toBe(true);
    await write(view);
    mockSend.mockRejectedValueOnce(err);
    await fireEvent.press(view.getByText('Send'));
    await act(async () => undefined);
    expectEditor(view);
    expect(view.getByText(errorMessage(err, 'Failed to send nudge.'))).toBeTruthy();
    if (kind === 'no reason given') expect(view.getByText('Failed to send nudge.')).toBeTruthy();
    expect(closedRefusals.has('c1')).toBe(false);
    expect(view.queryByText(THEM_LINE)).toBeNull();
  });

  // A second press while the first send is in flight.
  it('a second Send while one is in flight sends nothing more; the refusal then says why', async () => {
    const view = await mount(many);
    expect(await tap(view)).toBe(true);
    await write(view);
    const first = deferred();
    const press = onPressOf(view.getByText('Send'));
    await act(() => { void press(); void press(); }); // a double tap, both before the button greys out
    expect(view.getByText('Sending…')).toBeTruthy();
    await pressHeld(view.getByText('Sending…')); // and again once it has
    expect(mockSend).toHaveBeenCalledTimes(1);
    await first.reject(CLOSED_ANSWERS['403 messaging.blocked']);
    if (row) expectSaysWhy(view, THEM_LINE); else expectPeekSaysWhy(view, THEM_LINE);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('Cancel and the same entry again while the send is in flight: the words are there, and the refusal says why at once', async () => {
    const view = await mount(many);
    expect(await tap(view)).toBe(true);
    await write(view);
    const first = deferred();
    await pressHeld(view.getByText('Send'));
    await fireEvent.press(view.getByLabelText('Cancel'));
    expect(view.queryByLabelText('Nudge message')).toBeNull();
    expect(await tap(view)).toBe(true); // the second press, the first send still in flight
    expect(view.getByLabelText('Nudge message').props.value).toBe(BODY);
    expect(view.getByText('Sending…')).toBeTruthy();
    await first.reject(CLOSED_ANSWERS['403 messaging.blocked']);
    if (row) expectSaysWhy(view, THEM_LINE); else expectPeekSaysWhy(view, THEM_LINE);
    expect(announce).toHaveBeenCalledWith(THEM_LINE);
    expect(mockSend).toHaveBeenCalledTimes(1);
    await expectDraftKept(view, entry);
  });

  it('Cancel and the same entry again while the send is in flight: a sent nudge closes that form and clears its words', async () => {
    const view = await mount(many);
    expect(await tap(view)).toBe(true);
    await write(view);
    const first = deferred();
    await pressHeld(view.getByText('Send'));
    await fireEvent.press(view.getByLabelText('Cancel'));
    expect(await tap(view)).toBe(true);
    await first.resolve({});
    expect(view.queryByLabelText('Nudge message')).toBeNull();
    expect(await tap(view)).toBe(true);
    expectEditor(view, '', '');
  });
});

describe('a send\'s answer acts only on the form it was sent from (Needs you: Jordan sent, then Casey\'s form)', () => {
  const tap = ENTRIES['Needs you Nudge'].tap;
  async function jordanInFlightThenCasey() {
    const view = await mount(false, [jordan, casey]);
    expect(await tap(view, 'c1')).toBe(true);
    await write(view);
    const first = deferred();
    await pressHeld(view.getByText('Send'));
    await fireEvent.press(view.getByLabelText('Cancel'));
    expect(await tap(view, 'c2')).toBe(true);
    await write(view, 'Casey', 'Your plan is ready.');
    return { view, first };
  }

  it('Jordan\'s refusal leaves Casey\'s form open with her words and Send; Jordan is remembered as closed', async () => {
    const { view, first } = await jordanInFlightThenCasey();
    await first.reject(CLOSED_ANSWERS['403 messaging.blocked']);
    expectEditor(view, 'Casey', 'Your plan is ready.');
    expect(closedRefusals.has('c1')).toBe(true);
    expect(closedRefusals.has('c2')).toBe(false);
  });

  it('Jordan\'s sent nudge leaves Casey\'s form open with her words and Send', async () => {
    const { view, first } = await jordanInFlightThenCasey();
    await first.resolve({});
    expectEditor(view, 'Casey', 'Your plan is ready.');
  });

  it('Jordan\'s plain failure puts no error on Casey\'s form', async () => {
    const { view, first } = await jordanInFlightThenCasey();
    await first.reject(OTHER_REFUSALS.offline);
    expectEditor(view, 'Casey', 'Your plan is ready.');
    expect(view.queryByText(errorMessage(OTHER_REFUSALS.offline, 'Failed to send nudge.'))).toBeNull();
  });
});
