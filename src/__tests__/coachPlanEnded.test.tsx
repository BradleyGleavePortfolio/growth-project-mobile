/**
 * "Plan ended last 7 days, {N}" on the coach Home (CHURN-M; ruling v3 6328335815 items 5-7; RENEWAL3 P1, P1-0, K1-K3):
 * b#1130's list, only when the server returns it; grouped by days since the end; a row opens to "Ask Roman to write"
 * (the Home's ask-first sheet, b#1130's draft route, nothing sent without Send) and "Message" (the chat in Messages).
 */
import React from 'react';
import { BackHandler, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import {
  groupPlanEnded, homeLabel, homeLine, homeParts, messagedLine, parsePlanEndedPage, readPlanEnded, rowLine, rowParts, withoutBlocked,
  type PlanEndedRow,
} from '../screens/coach/home-v11/planEndedData';
import { useBlockedUsersStore } from '../store/blockedUsersStore';
import { prefsStorage } from '../storage/mmkv';

const [mockNavigate, mockGet, mockPost, mockApprove, mockReject] = Array.from({ length: 5 }, () => jest.fn());
const mockFocus = { home: true }; // whether the Home is the screen in front (false: another tab or a pushed screen)
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, isFocused: () => mockFocus.home }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 47, bottom: 34, left: 0, right: 0 };
  return { useSafeAreaInsets: () => insets, SafeAreaInsetsContext: jest.requireActual('react').createContext(insets) };
});
jest.mock('react-native-svg', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const El = ({ children, testID }: { children?: React.ReactNode; testID?: string }) => R.createElement(View, { testID }, children);
  return { __esModule: true, default: El, Circle: El };
});
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: { softImpact: jest.fn(), mediumImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../services/commandCenterApi', () => ({ ...jest.requireActual('../services/commandCenterApi'), __USING_MOCK_DATA: false, commandCenterApi: { getOverview: jest.fn() } }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  coachApi: { getUnreadCounts: () => Promise.resolve({ data: { total: 0, by_client: {} } }) },
}));
jest.mock('../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { approveDraft: (id: string) => mockApprove(id), rejectDraft: (id: string) => mockReject(id) },
}));
const mockStore = { clients: [] as unknown[], filterStatus: 'active', loadError: null as string | null, loadClients: jest.fn(() => Promise.resolve()) };
jest.mock('../store/coachStore', () => {
  const useCoachStore = (sel: (s: typeof mockStore) => unknown) => sel(mockStore);
  useCoachStore.getState = () => mockStore;
  return { useCoachStore };
});
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => Promise.resolve(0) }));
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => ({ data: { drafts: [] }, refetch: jest.fn() }) }));
jest.mock('../config/featureFlags', () => ({ featureFlags: { coachHomeV11: true, romanChat: true, coachBrief: false, coachTabsV2: true } }));
jest.mock('../screens/coach/command-center/CoachHomeCards', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({
  coachHomeSources: { monthSoFar: () => Promise.reject(new Error('x')), nextPayout: () => Promise.reject(new Error('x')), ltv: () => Promise.reject(new Error('x')), atRisk: () => Promise.resolve([]) },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CommandCenterScreen = require('../screens/coach/command-center/CommandCenterScreen').default as React.ComponentType;

const row = (id: string, name: string, days: number, pkg = '12-week block', messaged: string | null = null) => ({
  client_id: id, first_name: name.split(' ')[0], name, avatar_url: null, ended_at: '2026-10-21T09:00:00Z', ended_on: '2026-10-21',
  days_since: days, group: days === 0 ? 'today' : 'this_week', package_name: pkg, last_coach_message_at: messaged,
});
const ROWS = [row('c1', 'Maya Ortiz', 0), row('c2', 'Dev Patel', 0, 'Monthly coaching'), row('c3', 'Sam Okafor', 1, 'Monthly coaching', '2026-10-20T15:00:00Z'), row('c4', 'Lena Fischer', 3), row('c5', 'Omar Haddad', 6)];
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ time_zone: 'America/Los_Angeles', today: '2026-10-21', total: items.length, today_count: 0, items, next_cursor: null, ...extra });
let churned: () => Promise<unknown>;
let rosterSize = 30;
const http404 = () => Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: { code: 'PLAN_RENEWAL_OFF' } } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus.home = true;
  rosterSize = 30;
  churned = () => Promise.resolve({ data: page(ROWS) });
  mockGet.mockImplementation((url: string) => (url === '/v1/coach/churned-clients' ? churned()
    : Promise.resolve({ data: { roster_size: rosterSize, active_today: 21, check_in_rate_7day: 0.82, open_alerts: 0, at_risk_count: 0, win_streak_count: 0, unread_messages: 0, pending_actions: 0 } })));
  mockPost.mockResolvedValue({ data: { enabled: true, provider: 'anthropic', reply: 'Hi Maya, how did the block feel?', approval: { required: true, status: 'pending', draft_id: 'dr-9' }, reason: { kind: 'plan_ended' } } });
  mockApprove.mockResolvedValue({ ok: true });
  mockReject.mockResolvedValue({ ok: true });
});

async function renderHome() {
  const view = await render(<CommandCenterScreen />);
  await waitFor(() => expect(view.getByTestId('home-alerts')).toBeTruthy());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return view;
}
type View = Awaited<ReturnType<typeof renderHome>>;
const press = (v: View, ...ids: string[]) => ids.reduce((p, id) => p.then(() => fireEvent.press(v.getByTestId(id))), Promise.resolve());
const churnReads = () => mockGet.mock.calls.filter(([url]) => url === '/v1/coach/churned-clients').length;

describe('plan ended: the read and its words', () => {
  it('reads every page, newest first, and is off on a 404 or an answer that is not the list', async () => {
    mockGet.mockResolvedValueOnce({ data: page(ROWS.slice(0, 2), { total: 3, next_cursor: 'k' }) }).mockResolvedValueOnce({ data: page(ROWS.slice(2, 3), { total: 3 }) });
    const all = await readPlanEnded();
    expect(mockGet.mock.calls).toEqual([['/v1/coach/churned-clients', { params: { take: 50 } }], ['/v1/coach/churned-clients', { params: { take: 50, cursor: 'k' } }]]);
    expect([all?.total, all?.items.map((r) => r.client_id)]).toEqual([3, ['c1', 'c2', 'c3']]);
    mockGet.mockImplementationOnce(http404);
    await expect(readPlanEnded()).resolves.toBeNull();
    mockGet.mockResolvedValueOnce({ data: { roster_size: 3 } });
    await expect(readPlanEnded()).resolves.toBeNull();
    mockGet.mockRejectedValueOnce(new Error('Network Error'));
    await expect(readPlanEnded()).rejects.toThrow('Network Error');
  });
  it('groups by days since the end (0, 1, 2 and more) and words each row', () => {
    const p = parsePlanEndedPage(page([...ROWS, { client_id: '', days_since: 0 }, row('c6', '', 2, '')]))!;
    expect(p.items.map((r) => r.client_id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(groupPlanEnded(p.items).map((g) => [g.label, g.rows.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Earlier this week', 3]]);
    const [maya, , sam, lena, , c6] = p.items as PlanEndedRow[];
    expect([rowLine(maya), rowLine(sam), rowLine(lena), rowLine(c6), homeLine(lena)]).toEqual([
      'Plan ended today · 12-week block', 'Plan ended 1 day ago · Monthly coaching', 'Plan ended 3 days ago · 12-week block', 'Plan ended 2 days ago', 'Lena Fischer · ended 3 days ago',
    ]);
    expect(c6.name).toBe('Unnamed client');
    // The tail the screen keeps whole: the same words, cut only at " · " (RENEWAL3's nowrap span).
    expect([rowParts(maya), rowParts(c6), homeParts(lena)]).toEqual([
      { lead: 'Plan ended today', tail: '12-week block' }, { lead: 'Plan ended 2 days ago', tail: '' }, { lead: 'Lena Fischer', tail: 'ended 3 days ago' },
    ]);
    expect([rowLine(maya), homeLine(lena)].join('').match(/[\u00a0\u2011\u2060]/)).toBeNull(); // the approved characters, no stand-ins
    expect(messagedLine('2026-10-20T15:00:00Z', 'America/Los_Angeles')).toBe('Messaged Oct 20');
    expect(homeLabel(p)).toBe('Plan ended last 7 days, 7. Maya Ortiz, plan ended today, and 6 more'); // the server's total stands
    expect(homeLabel({ ...p, total: 1, items: [maya] })).toBe('Plan ended last 7 days, 1. Maya Ortiz, plan ended today');
  });
});

describe('plan ended on the coach Home', () => {
  it('shows P1 under the rings with the newest client and opens the grouped list', async () => {
    const v = await renderHome();
    expect(v.getByTestId('home-plan-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 5. Maya Ortiz, plan ended today, and 4 more');
    const line = within(v.getByTestId('home-plan-ended-line'));
    expect([line.getByText('Maya Ortiz ·'), line.getByText('ended today')].every(Boolean)).toBe(true); // "ended today" stays whole
    await press(v, 'home-plan-ended');
    const k2 = within(v.getByTestId('plan-ended-line-c1'));
    expect([k2.getByText('Plan ended today ·'), k2.getByText('12-week block')].every(Boolean)).toBe(true); // the package stays whole
    expect(v.getByTestId('plan-ended-row-c1').props.accessibilityLabel).toBe('Maya Ortiz. Plan ended today · 12-week block');
    expect(v.getByTestId('plan-ended-list')).toBeTruthy();
    expect(v.getByText('NEWEST FIRST')).toBeTruthy();
    expect(['today', 'yesterday', 'week'].map((k) => v.getByTestId(`plan-ended-${k}`) && v.getByText(k === 'week' ? 'EARLIER THIS WEEK' : k.toUpperCase()).props.accessibilityLabel)).toEqual(['Today, 2', 'Yesterday, 1', 'Earlier this week, 2']);
    expect(v.getByText('Messaged Oct 20')).toBeTruthy();
    expect(churnReads()).toBe(2); // the Home's read, and a fresh one on open
    await press(v, 'plan-ended-back');
    await waitFor(() => expect(v.queryByTestId('plan-ended-list')).toBeNull());
  });
  it('shows P1-0, not a button, when nobody ended', async () => {
    churned = () => Promise.resolve({ data: page([]) });
    const v = await renderHome();
    expect(v.queryByTestId('home-plan-ended')).toBeNull();
    expect(v.getByTestId('home-plan-ended-none').props.accessibilityLabel).toBe('Plan ended last 7 days, 0. Clients whose plan ended show here, newest first.');
    expect(v.getByTestId('home-plan-ended-none').props.accessibilityRole).toBeUndefined();
  });
  it('draws no P1-0 on a Home with no clients yet', async () => {
    churned = () => Promise.resolve({ data: page([]) });
    rosterSize = 0;
    const v = await renderHome();
    expect(v.getByTestId('home-hero-zero')).toBeTruthy();
    expect([v.queryByTestId('home-plan-ended'), v.queryByTestId('home-plan-ended-none')]).toEqual([null, null]);
  });
  it.each([['off on this server (404)', http404], ['not loaded', () => Promise.reject(new Error('Network Error'))]])('shows nothing when the list is %s', async (_, answer) => {
    churned = answer;
    const v = await renderHome();
    expect([v.queryByTestId('home-plan-ended'), v.queryByTestId('home-plan-ended-none')]).toEqual([null, null]);
  });
  it('keeps the rows and says so quietly when a re-read fails', async () => {
    const v = await renderHome();
    churned = () => Promise.reject(new Error('Network Error'));
    await press(v, 'home-plan-ended');
    await waitFor(() => expect(v.getByText('This list could not load. Check your connection, then try again.')).toBeTruthy());
    expect(v.getByText('Maya Ortiz')).toBeTruthy();
  });
  it('opens a row to Message, which goes to the chat in Messages; nothing is sent', async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c2');
    expect(v.getByTestId('plan-ended-row-c2').props.accessibilityState).toEqual({ expanded: true });
    await press(v, 'plan-ended-message');
    expect(mockNavigate).toHaveBeenCalledWith('Messages', { screen: 'ClientMessages', params: { clientId: 'c2', clientName: 'Dev Patel', initialDraft: undefined }, initial: false });
    expect([mockPost.mock.calls, mockApprove.mock.calls]).toEqual([[], []]);
  });
  it("asks first, asks b#1130's draft route, and sends only on Send", async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c1');
    // K2's ask carries Roman's mark (deep disc, gold ring, gold serif R), hidden from screen readers: the button names Roman.
    const mark = within(v.getByTestId('plan-ended-ask')).getByTestId('roman-mark', { includeHiddenElements: true });
    expect([mark.props.importantForAccessibility, within(mark).getByText('R', { includeHiddenElements: true }).props.style]).toEqual(['no-hide-descendants', expect.arrayContaining([expect.objectContaining({ fontFamily: 'CormorantGaramond_500Medium', color: '#D4B96B' })])]);
    await press(v, 'plan-ended-ask');
    expect(v.getByText('Ask Roman to write to Maya?')).toBeTruthy();
    // the K3 context chip: RN3-34 in two pieces, so "12-week block" moves down whole at large text (KeepTail, as on P1/K2)
    expect(within(v.getByTestId('home-draft-about-line')).getAllByText(/./).map((t) => t.props.children)).toEqual(['Plan ended today ·', '12-week block']);
    const head = within(v.getByTestId('home-draft-head')); // K3a: Roman's deep head with the mark and "Roman" (RN3-33)
    expect([head.getByTestId('roman-mark', { includeHiddenElements: true }), head.getByText('ROMAN', { includeHiddenElements: true }), head.getByText('Ask Roman to write to Maya?')].every(Boolean)).toBe(true);
    // RENEWAL3 K3a/K3b: white body under the deep head (r2b.py `.ask`), and Roman's draft box white too (`.draft`; Sol m#866 B1)
    expect(StyleSheet.flatten(v.getByTestId('home-draft-sheet').props.style).backgroundColor).toBe('#FFFFFF');
    expect(mockPost).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(v.getByTestId('home-draft-ask')); });
    expect(mockPost).toHaveBeenCalledWith('/v1/coach/churned-clients/c1/draft', {});
    await waitFor(() => expect(v.getByTestId('home-draft-text').props.children).toBe('Hi Maya, how did the block feel?'));
    expect(StyleSheet.flatten(v.getByTestId('home-draft-box').props.style).backgroundColor).toBe('#FFFFFF');
    expect(mockApprove).not.toHaveBeenCalled();
    const before = churnReads();
    await act(async () => { fireEvent.press(v.getByTestId('home-draft-send')); });
    expect(mockApprove).toHaveBeenCalledWith('dr-9');
    await waitFor(() => expect(churnReads()).toBe(before + 1)); // "Messaged" comes from the re-read
  });
  it("says Roman can't write while draft.coach_message is off, and Not now leaves nothing pending", async () => {
    mockPost.mockResolvedValue({ data: { enabled: false, reply: '', approval: { required: false, draft_id: null } } });
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c1', 'plan-ended-ask');
    await act(async () => { fireEvent.press(v.getByTestId('home-draft-ask')); });
    await waitFor(() => expect(v.getByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy());
    await press(v, 'home-draft-close');
    expect([mockApprove.mock.calls, mockReject.mock.calls, v.queryByTestId('home-draft-sheet')]).toEqual([[], [], null]);
    expect(v.getByTestId('plan-ended-list')).toBeTruthy(); // back on the list
  });
});

describe('plan ended: blocked clients never show (b#1141; owner: hide all messaging)', () => {
  afterEach(() => act(() => { useBlockedUsersStore.setState({ blocked: [] }); }));
  const block = (id: string, displayName: string) => act(() => {
    useBlockedUsersStore.setState({ blocked: [{ id, displayName, role: 'client', blockedAt: '2026-10-23T10:00:00Z' }] });
  });
  it('drops a client this coach blocked from P1, the list and the counts; the others stay (control)', async () => {
    const v = await renderHome();
    await block('c1', 'Maya Ortiz');
    expect(v.getByTestId('home-plan-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 4. Dev Patel, plan ended today, and 3 more');
    await press(v, 'home-plan-ended');
    expect([v.queryByTestId('plan-ended-row-c1'), v.queryByText('Maya Ortiz')]).toEqual([null, null]);
    expect(v.getByText('TODAY').props.accessibilityLabel).toBe('Today, 1');
    expect(v.getByTestId('plan-ended-row-c2')).toBeTruthy(); // not blocked: Message and Ask Roman as before
    await press(v, 'plan-ended-row-c2');
    expect([v.getByTestId('plan-ended-message'), v.getByTestId('plan-ended-ask')].every(Boolean)).toBe(true);
  });
  it('keeps the page as the server sent it when nobody listed is blocked', () => {
    const p = parsePlanEndedPage(page(ROWS))!;
    expect(withoutBlocked(p, [])).toBe(p);
    expect(withoutBlocked(p, ['someone-else'])).toBe(p);
    expect(withoutBlocked(p, ['c3', 'c4'])).toEqual({ ...p, total: 3, items: p.items.filter((r) => r.client_id !== 'c3' && r.client_id !== 'c4') });
    expect(withoutBlocked(null, ['c1'])).toBeNull();
  });
  it("re-reads the list when the draft route says the client is gone (404), and sends nothing", async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c1', 'plan-ended-ask');
    mockPost.mockRejectedValueOnce(Object.assign(new Error('404'), { response: { status: 404, data: { code: 'CHURNED_CLIENT_NOT_FOUND' } } }));
    churned = () => Promise.resolve({ data: page(ROWS.slice(1)) }); // the server now leaves Maya out
    const before = churnReads();
    await act(async () => { fireEvent.press(v.getByTestId('home-draft-ask')); });
    await waitFor(() => expect(v.getByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy());
    expect(v.queryByTestId('home-draft-ask')).toBeNull(); // no Try again: a second ask gets the same 404 (LO C2)
    await waitFor(() => expect(churnReads()).toBe(before + 1));
    expect(mockApprove).not.toHaveBeenCalled();
    await press(v, 'home-draft-close');
    await waitFor(() => expect(v.queryByTestId('plan-ended-row-c1')).toBeNull());
  });
});

describe('plan ended: Android back (LO B1)', () => {
  // jest-expo runs as iOS, where BackHandler does nothing: run Android's dispatch here. Listeners run newest first and the
  // first that returns true stops the press; React Navigation's own back (added when the app starts) is the oldest.
  let listeners: (() => boolean | null | undefined)[] = [];
  const navigatorBack = jest.fn(() => true);
  const pressBack = () => act(() => { for (const h of [...listeners].reverse()) if (h()) return; });
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    listeners = [navigatorBack];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      listeners.push(h);
      return { remove: () => void (listeners = listeners.filter((x) => x !== h)) };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('closes the open list while the Home is in front', async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended');
    await pressBack();
    await waitFor(() => expect(v.queryByTestId('plan-ended-list')).toBeNull());
    expect(navigatorBack).not.toHaveBeenCalled();
  });
  it('after Message, back in the chat is the chat\'s back: the list is closed and holds no listener', async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c2', 'plan-ended-message');
    expect(mockNavigate).toHaveBeenCalledWith('Messages', expect.objectContaining({ screen: 'ClientMessages' }));
    expect(v.queryByTestId('plan-ended-list')).toBeNull();
    mockFocus.home = false; // Messages is in front
    await pressBack();
    expect(navigatorBack).toHaveBeenCalledTimes(1);
  });
  it('on another tab or a pushed screen, back passes through and the list stays for the return', async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended');
    mockFocus.home = false;
    await pressBack();
    expect(navigatorBack).toHaveBeenCalledTimes(1);
    expect(v.getByTestId('plan-ended-list')).toBeTruthy();
  });
});

describe('plan ended: screen readers stay in the open list (LO C1)', () => {
  it('marks the list modal and hides the Home under it from TalkBack', async () => {
    const v = await renderHome();
    const home = () => v.getByTestId('coach-home-v11', { includeHiddenElements: true }).props.importantForAccessibility;
    expect(home()).toBe('auto');
    await press(v, 'home-plan-ended');
    expect([v.getByTestId('plan-ended-list').props.accessibilityViewIsModal, home()]).toEqual([true, 'no-hide-descendants']);
    await press(v, 'plan-ended-row-c1', 'plan-ended-ask'); // K3's sheet takes the screen reader while it is up
    expect(v.getByTestId('plan-ended-list', { includeHiddenElements: true }).props.accessibilityViewIsModal).toBe(false);
    expect(v.getByText('Ask Roman to write to Maya?')).toBeTruthy();
  });
});

describe('plan ended: a cold start reads the block list before any row shows (LO m#866 B1, m#859 C1)', () => {
  const MAYA = { id: 'c1', displayName: 'Maya Ortiz', role: 'client', blockedAt: '2026-10-20T10:00:00Z' };
  const KEY = 'blocked_user_ids_v1:coach-1';
  const appStart = () => act(() => { useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null }); }); // nothing read yet
  beforeEach(appStart);
  afterEach(async () => { await prefsStorage.delete(KEY); await appStart(); });
  const blocksAnswer = (answer: () => Promise<unknown>) => {
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation((url: string, ...rest: unknown[]) => (url === '/users/blocks' ? answer() : base(url, ...rest)));
  };
  const expectNoMaya = async (v: View) => {
    expect(v.getByTestId('home-plan-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 4. Dev Patel, plan ended today, and 3 more');
    await press(v, 'home-plan-ended');
    expect([v.queryByTestId('plan-ended-row-c1'), v.queryByText('Maya Ortiz')]).toEqual([null, null]);
    expect(v.getByText('TODAY').props.accessibilityLabel).toBe('Today, 1');
  };
  it("leaves out a client blocked earlier on this phone, read from the phone's saved list (server down)", async () => {
    await prefsStorage.set(KEY, JSON.stringify([MAYA]));
    blocksAnswer(() => Promise.reject(new Error('Network Error')));
    const v = await renderHome();
    await expectNoMaya(v);
  });
  it("leaves out a client GET /users/blocks names (blocked on another phone; this phone's list is empty)", async () => {
    blocksAnswer(() => Promise.resolve({ data: { blocked: [{ blockedId: 'c1', displayName: 'Maya Ortiz', blockedAt: MAYA.blockedAt }] } }));
    const v = await renderHome();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/users/blocks'));
    await expectNoMaya(v);
  });
  it('shows no row until the list is read: P1 waits while the phone reads it', async () => {
    let done: (v: string | undefined) => void = () => undefined;
    const read = prefsStorage.getStringAsync.bind(prefsStorage);
    const spy = jest.spyOn(prefsStorage, 'getStringAsync').mockImplementation((k: string) => (k === KEY ? new Promise((r) => { done = r; }) : read(k)));
    try {
      const v = await renderHome();
      expect([v.queryByTestId('home-plan-ended'), v.queryByTestId('home-plan-ended-none')]).toEqual([null, null]);
      await act(async () => { done(JSON.stringify([MAYA])); });
      await waitFor(() => expect(v.getByTestId('home-plan-ended')).toBeTruthy());
      await expectNoMaya(v);
    } finally { spy.mockRestore(); }
  });
});

describe('plan ended: RENEWAL3 metrics, not the Home shared rows (LS B1)', () => {
  const st = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
  it('draws P1, K1/K2 and K3 at the GOAL sizes', async () => {
    const v = await renderHome();
    expect(['fontSize', 'lineHeight'].map((k) => st(v.getByText('Plan ended last 7 days, 5'))[k])).toEqual([15, 20]); // P1 title
    expect(['minHeight', 'marginTop', 'borderRadius'].map((k) => st(v.getByTestId('home-plan-ended'))[k])).toEqual([60, 12, 12]);
    await press(v, 'home-plan-ended');
    expect(['fontSize', 'lineHeight'].map((k) => st(v.getByText('Sam Okafor'))[k])).toEqual([15.5, 20]); // K1 name
    expect(['fontFamily', 'fontSize', 'lineHeight'].map((k) => st(v.getByText('Messaged Oct 20'))[k])).toEqual(['Inter_500Medium', 13, 18]);
    expect(['fontSize', 'lineHeight'].map((k) => st(within(v.getByTestId('plan-ended-today')).getByText('2', { includeHiddenElements: true }))[k])).toEqual([12, 16]); // Today's count badge
    expect(['minHeight', 'paddingHorizontal'].map((k) => st(v.getByTestId('plan-ended-row-c1'))[k])).toEqual([72, 14]);
    await press(v, 'plan-ended-row-c1');
    expect(st(v.getByTestId('plan-ended-ask')).minHeight).toBe(48);
    expect(st(v.getByTestId('roman-mark', { includeHiddenElements: true })).width).toBe(25); // K2's .rmk: a 22 disc and its 1.5 ring
    await press(v, 'plan-ended-ask');
    expect(['fontSize', 'lineHeight'].map((k) => st(v.getByText('Ask Roman to write to Maya?'))[k])).toEqual([20, 26]); // K3 title
    expect(['fontSize', 'lineHeight'].map((k) => st(v.getByText('You read it before it goes. Nothing is sent until you tap Send.'))[k])).toEqual([14.5, 21]);
    const marks = v.getAllByTestId('roman-mark', { includeHiddenElements: true });
    expect(st(marks[marks.length - 1]).width).toBe(39); // K3's head: a 32 disc, a 2 deep gap, the 1.5 ring
  });
});
