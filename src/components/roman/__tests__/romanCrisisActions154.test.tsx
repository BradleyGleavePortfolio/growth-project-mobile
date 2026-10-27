/**
 * CRISIS-BTN (owner "#CRISIS-2B - all 3 buttons" and "thw call 911 988 buttons
 * - Nevermind, do them!", flag crisisActions): the actions under Roman's fixed
 * crisis reply, in the server's order with the first as the one forest button.
 * Every tap lands somewhere real (tel:911, tel:988, sms:988, the coach chat), a
 * coachless client and a coach get the number actions only, and nothing new
 * shows with the flag off, without the server marker, or for reply text alone.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { NavigationContext } from '@react-navigation/native';
import RomanMessageBubble from '../RomanMessageBubble';
import RomanConversationScreen from '../../../screens/settings/RomanConversationScreen';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { authEpoch } from '../../../services/accountBinding';
import type { RomanMessage } from '../../../api/romanApi';
import type { RomanSafetyAction } from '../../../api/romanSafetyActions';
import type { RomanChatsApi } from '../../../api/romanChatsApi';

const mockFlag = { on: true };
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  // A live getter (a spread would copy the value once, at import time).
  const featureFlags = Object.defineProperty({ ...actual.featureFlags }, 'crisisActions', { get: () => mockFlag.on, enumerable: true });
  return { ...actual, featureFlags };
});
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));
let mockUser: { id: string; email: string; role: string; coach_id?: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { softImpact: jest.fn(async () => undefined), selection: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));

// The server's order: each fixed reply leads with the number it names first.
const EMERGENCY_CALLS: RomanSafetyAction[] = ['call_911', 'call_988', 'text_988'];
const SELF_HARM_CALLS: RomanSafetyAction[] = ['call_988', 'text_988', 'call_911'];
const EMERGENCY: RomanSafetyAction[] = [...EMERGENCY_CALLS, 'message_coach'];
const SELF_HARM: RomanSafetyAction[] = [...SELF_HARM_CALLS, 'message_coach'];
const LANDS: Record<string, string> = { 'Call 9 1 1': 'tel:911', 'Call 988': 'tel:988', 'Text 988': 'sms:988' };
const reply = (safetyActions?: RomanSafetyAction[], content = 'Fixed reply.'): RomanMessage => ({
  id: 'a1', role: 'assistant', content, interrupted: false, createdAt: '2026-10-17T08:00:00.000Z',
  ...(safetyActions ? { safetyActions } : {}),
});
const nav = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => undefined) };
const inNav = (el: React.ReactElement) => <NavigationContext.Provider value={nav as never}>{el}</NavigationContext.Provider>;
const flat = (n: TestInstance) => StyleSheet.flatten(n.props.style) ?? {};
const coached = { id: 'u1', email: '', role: 'student', coach_id: 'c1' };
const spoken = (buttons: TestInstance[]) => buttons.map((b) => b.props.accessibilityLabel as string);

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockFlag.on = true;
  mockUser = coached;
  mockGet.mockResolvedValue({ data: { name: 'Sam Rivera' } });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

it.each([
  ['emergency', EMERGENCY, ['Call 9 1 1', 'Call 988', 'Text 988', 'Message Sam']],
  ['self-harm', SELF_HARM, ['Call 988', 'Text 988', 'Call 9 1 1', 'Message Sam']],
])('the %s reply, coached client: the server\u2019s order, the first is the forest button, each tap lands', async (_l, actions, order) => {
  const s = await render(inNav(<RomanMessageBubble message={reply(actions)} testID="t" />));
  await s.findByRole('button', { name: 'Message Sam' });
  expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach');
  expect(s.getByTestId('t-crisis')).toBeTruthy();
  expect(spoken(s.getAllByRole('button'))).toEqual(order);
  expect(s.getByText('Call 911')).toBeTruthy();
  const [first, ...rest] = s.getAllByRole('button');
  expect(flat(first)).toMatchObject({ minHeight: 54, borderRadius: 12 });
  for (const b of rest) expect(flat(b)).toMatchObject({ minHeight: 48, borderRadius: 12, borderWidth: 1 });
  for (const b of s.getAllByRole('button')) {
    await fireEvent.press(b);
    const url = LANDS[b.props.accessibilityLabel as string];
    if (url) expect(openURL).toHaveBeenLastCalledWith(url);
  }
  expect(openURL).toHaveBeenCalledTimes(3);
  expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  expect(HapticService.softImpact).toHaveBeenCalledTimes(4);
  // The actions sit outside the reply's spoken text.
  expect(s.getByTestId('t-reply').props.accessibilityLabel).toBe('Roman said: Fixed reply.');
});

it('no coach name yet or a failed read keeps "Message your coach"', async () => {
  mockGet.mockRejectedValue(new Error('offline'));
  const s = await render(inNav(<RomanMessageBubble message={reply(SELF_HARM)} />));
  await fireEvent.press(await s.findByRole('button', { name: 'Message your coach' }));
  expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
});

it.each([
  ['a coachless client (server calls)', { id: 'u2', email: '', role: 'student' }, SELF_HARM_CALLS],
  ['a coachless client (stale offer)', { id: 'u2', email: '', role: 'student' }, EMERGENCY],
  ['a coach on their own Roman', { id: 'c1', email: '', role: 'coach' }, SELF_HARM],
  ['a coached client the server did not offer it to', coached, EMERGENCY_CALLS],
])('%s sees the number actions only, in the server\u2019s order', async (_label, user, actions) => {
  mockUser = user;
  const s = await render(inNav(<RomanMessageBubble message={reply(actions)} />));
  const calls = actions[0] === 'call_911' ? ['Call 9 1 1', 'Call 988', 'Text 988'] : ['Call 988', 'Text 988', 'Call 9 1 1'];
  expect(spoken(s.getAllByRole('button'))).toEqual(calls);
  expect(s.queryByText(/^Message/)).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
});

it('without a navigator there is no Message button (never a dead tap)', async () => {
  const s = await render(<RomanMessageBubble message={reply(EMERGENCY)} />);
  expect(spoken(s.getAllByRole('button'))).toEqual(['Call 9 1 1', 'Call 988', 'Text 988']);
  expect(s.queryByText(/^Message/)).toBeNull();
});

it.each([
  ['the flag is off', false, reply(EMERGENCY)],
  ['the reply has no marker', true, reply(undefined, 'Your step goal is 9880. Text me after.')],
  ['the turn is the client\u2019s own', true, { ...reply(SELF_HARM), role: 'user' as const }],
])('nothing new shows when %s', async (_label, on, message) => {
  mockFlag.on = on;
  const s = await render(inNav(<RomanMessageBubble message={message} testID="t" />));
  expect(s.queryByTestId('t-crisis')).toBeNull();
  expect(s.queryByRole('button')).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
});

it.each([
  [false, 0],
  [true, 1],
])('a fresh reply brings the actions in last (Reduce Motion %s: opacity %s)', async (reduceMotion, start) => {
  const s = await render(inNav(<RomanMessageBubble message={reply(SELF_HARM_CALLS)} reveal reduceMotion={reduceMotion} testID="t" />));
  let n: TestInstance | null = s.getByTestId('t-crisis');
  while (n && typeof flat(n).opacity !== 'number') n = n.parent;
  expect(n && flat(n).opacity).toBe(start);
});

it('the read-only transcript shows the same actions under a marked reply', async () => {
  const page = { ok: true as const, value: { messages: [reply(EMERGENCY_CALLS), { ...reply(), id: 'u0', role: 'user' as const, content: 'Hi' }], nextCursor: null } };
  const chats = { list: jest.fn(), readMessages: jest.fn(async () => page), deleteOne: jest.fn(), deleteAll: jest.fn() };
  const params = {
    id: 'cx1', ownerId: 'u1', binding: { subject: 'sub:u1', epoch: authEpoch() },
    startedAt: '2026-10-17T08:00:00.000Z', surface: 'client' as const, messageCount: 2,
  };
  const s = await render(inNav(
    <RomanConversationScreen navigation={nav as never} route={{ params }} api={chats as unknown as RomanChatsApi} sessionUserId={() => 'u1'} />,
  ));
  await fireEvent.press(await s.findByRole('button', { name: 'Call 9 1 1' }));
  expect(openURL).toHaveBeenLastCalledWith('tel:911');
  expect(s.getByTestId('roman-transcript-crisis-a1')).toBeTruthy();
  expect(s.getByRole('button', { name: 'Call 988' })).toBeTruthy();
  expect(s.getByRole('button', { name: 'Text 988' })).toBeTruthy();
});

it('the coach chat route the Message button opens is registered (Home tab > Messages)', () => {
  const navSrc = fs.readFileSync(path.join(__dirname, '../../../navigation/ClientNavigator.tsx'), 'utf8');
  const home = navSrc.slice(navSrc.indexOf('<HomeStackNav.Navigator'), navSrc.indexOf('</HomeStackNav.Navigator>'));
  expect(home).toMatch(/<HomeStackNav\.Screen name="Messages"\s+component=\{MessagesScreen\} \/>/);
  expect(navSrc).toMatch(/<Tab\.Screen\s+name="Home"/);
});

// FR-880R3 (operator ruling, agent 173, two-way; owner 10-23 "Dissapear"): while the coaching chat is closed (either
// person's block) the crisis card offers no "Message {coach}"; every number action stays, and an open chat brings it back.
describe('a closed coaching chat', () => {
  const { queryClient } = jest.requireActual('../../../services/queryClient');
  const { COACH_CHAT_KEY } = jest.requireActual('../../../hooks/useCoachChatClosed');
  const { useBlockedUsersStore } = jest.requireActual('../../../store/blockedUsersStore');
  const thread = { closed: true };
  beforeEach(() => {
    queryClient.clear();
    thread.closed = true;
    mockGet.mockImplementation(async (u: string) =>
      u === '/messages?limit=1' ? { data: [], headers: thread.closed ? { 'x-conversation-closed': 'blocked_by_them' } : {} } : { data: { name: 'Sam Rivera' } });
  });
  afterEach(() => { queryClient.clear(); useBlockedUsersStore.setState({ blocked: [] }); });

  it.each([
    ['emergency', EMERGENCY, ['Call 9 1 1', 'Call 988', 'Text 988']],
    ['self-harm', SELF_HARM, ['Call 988', 'Text 988', 'Call 9 1 1']],
  ])('the coach blocked me (%s): the numbers only, never the coach first; a read that says open brings it back', async (_l, actions, calls) => {
    const s = await render(inNav(<RomanMessageBubble message={reply(actions)} testID="t" />));
    expect(s.queryByText(/^Message/)).toBeNull();
    await waitFor(() => expect(queryClient.getQueryData([...COACH_CHAT_KEY, 'c1'])).toBe(true));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach'));
    expect(spoken(s.getAllByRole('button'))).toEqual(calls);
    expect(s.queryByText(/^Message|Sam/)).toBeNull();
    const [first] = s.getAllByRole('button');
    expect(flat(first)).toMatchObject({ minHeight: 54 }); // the first number is still the forest button
    thread.closed = false;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: COACH_CHAT_KEY }); });
    expect(await s.findByRole('button', { name: 'Message Sam' })).toBeTruthy();
    expect(spoken(s.getAllByRole('button'))).toEqual([...calls, 'Message Sam']);
  });

  it('I block my coach: the button leaves at once; my unblock brings it back', async () => {
    thread.closed = false;
    const s = await render(inNav(<RomanMessageBubble message={reply(EMERGENCY)} />));
    expect(await s.findByRole('button', { name: 'Message Sam' })).toBeTruthy();
    await act(async () => useBlockedUsersStore.setState({ blocked: [{ id: 'c1', displayName: 'Sam', blockedAt: '2026-10-24T00:00:00Z' }] }));
    expect(s.queryByText(/^Message/)).toBeNull();
    expect(spoken(s.getAllByRole('button'))).toEqual(['Call 9 1 1', 'Call 988', 'Text 988']);
    await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
    expect(await s.findByRole('button', { name: 'Message Sam' })).toBeTruthy();
  });
});
