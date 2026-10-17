/**
 * CRISIS-BTN (owner "#CRISIS-2B - all 3 buttons", flag crisisActions): the
 * actions under Roman's fixed crisis reply. Every tap lands somewhere real
 * (tel:988, sms:988, the coach chat), a coachless client and a coach get the
 * two 988 actions, and nothing new shows with the flag off, without the
 * server marker, or for reply text alone.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
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

const ALL: RomanSafetyAction[] = ['call_988', 'text_988', 'message_coach'];
const PAIR: RomanSafetyAction[] = ['call_988', 'text_988'];
const reply = (safetyActions?: RomanSafetyAction[], content = 'Fixed reply.'): RomanMessage => ({
  id: 'a1', role: 'assistant', content, interrupted: false, createdAt: '2026-10-17T08:00:00.000Z',
  ...(safetyActions ? { safetyActions } : {}),
});
const nav = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => undefined) };
const inNav = (el: React.ReactElement) => <NavigationContext.Provider value={nav as never}>{el}</NavigationContext.Provider>;
const flat = (n: TestInstance) => StyleSheet.flatten(n.props.style) ?? {};
const coached = { id: 'u1', email: '', role: 'student', coach_id: 'c1' };

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockFlag.on = true;
  mockUser = coached;
  mockGet.mockResolvedValue({ data: { name: 'Sam Rivera' } });
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

it('a coached client gets Call 988, Text 988 and Message <first name>, and each tap lands', async () => {
  const s = await render(inNav(<RomanMessageBubble message={reply(ALL)} testID="t" />));
  const coach = await s.findByRole('button', { name: 'Message Sam' });
  expect(mockGet).toHaveBeenCalledWith('/v1/clients/me/coach');
  const call = s.getByRole('button', { name: 'Call 988' });
  const text = s.getByRole('button', { name: 'Text 988' });
  expect(s.getByTestId('t-crisis')).toBeTruthy();
  expect(flat(call)).toMatchObject({ minHeight: 54, borderRadius: 12 });
  for (const b of [text, coach]) expect(flat(b)).toMatchObject({ minHeight: 48, borderRadius: 12, borderWidth: 1 });
  await fireEvent.press(call);
  expect(openURL).toHaveBeenLastCalledWith('tel:988');
  await fireEvent.press(text);
  expect(openURL).toHaveBeenLastCalledWith('sms:988');
  await fireEvent.press(coach);
  expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
  expect(HapticService.softImpact).toHaveBeenCalledTimes(3);
  // The actions sit outside the reply's spoken text.
  expect(s.getByTestId('t-reply').props.accessibilityLabel).toBe('Roman said: Fixed reply.');
});

it('no coach name yet or a failed read keeps "Message your coach"', async () => {
  mockGet.mockRejectedValue(new Error('offline'));
  const s = await render(inNav(<RomanMessageBubble message={reply(ALL)} />));
  await fireEvent.press(await s.findByRole('button', { name: 'Message your coach' }));
  expect(nav.navigate).toHaveBeenCalledWith('Home', { screen: 'Messages' });
});

it.each([
  ['a coachless client (server pair)', { id: 'u2', email: '', role: 'student' }, PAIR],
  ['a coachless client (stale offer)', { id: 'u2', email: '', role: 'student' }, ALL],
  ['a coach on their own Roman', { id: 'c1', email: '', role: 'coach' }, ALL],
  ['a coached client the server did not offer it to', coached, PAIR],
])('%s sees the two 988 actions only', async (_label, user, actions) => {
  mockUser = user;
  const s = await render(inNav(<RomanMessageBubble message={reply(actions)} />));
  expect(s.getByRole('button', { name: 'Call 988' })).toBeTruthy();
  expect(s.getByRole('button', { name: 'Text 988' })).toBeTruthy();
  expect(s.queryByText(/^Message/)).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
});

it('without a navigator there is no Message button (never a dead tap)', async () => {
  const s = await render(<RomanMessageBubble message={reply(ALL)} />);
  expect(s.getByRole('button', { name: 'Call 988' })).toBeTruthy();
  expect(s.queryByText(/^Message/)).toBeNull();
});

it.each([
  ['the flag is off', false, reply(ALL)],
  ['the reply has no marker', true, reply(undefined, 'Your step goal is 9880. Text me after.')],
  ['the turn is the client\u2019s own', true, { ...reply(ALL), role: 'user' as const }],
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
  const s = await render(inNav(<RomanMessageBubble message={reply(PAIR)} reveal reduceMotion={reduceMotion} testID="t" />));
  let n: TestInstance | null = s.getByTestId('t-crisis');
  while (n && typeof flat(n).opacity !== 'number') n = n.parent;
  expect(n && flat(n).opacity).toBe(start);
});

it('the read-only transcript shows the same actions under a marked reply', async () => {
  const page = { ok: true as const, value: { messages: [reply(PAIR), { ...reply(), id: 'u0', role: 'user' as const, content: 'Hi' }], nextCursor: null } };
  const chats = { list: jest.fn(), readMessages: jest.fn(async () => page), deleteOne: jest.fn(), deleteAll: jest.fn() };
  const params = {
    id: 'cx1', ownerId: 'u1', binding: { subject: 'sub:u1', epoch: authEpoch() },
    startedAt: '2026-10-17T08:00:00.000Z', surface: 'client' as const, messageCount: 2,
  };
  const s = await render(inNav(
    <RomanConversationScreen navigation={nav as never} route={{ params }} api={chats as unknown as RomanChatsApi} sessionUserId={() => 'u1'} />,
  ));
  await fireEvent.press(await s.findByRole('button', { name: 'Call 988' }));
  expect(openURL).toHaveBeenLastCalledWith('tel:988');
  expect(s.getByTestId('roman-transcript-crisis-a1')).toBeTruthy();
  expect(s.getByRole('button', { name: 'Text 988' })).toBeTruthy();
});

it('the coach chat route the Message button opens is registered (Home tab > Messages)', () => {
  const navSrc = fs.readFileSync(path.join(__dirname, '../../../navigation/ClientNavigator.tsx'), 'utf8');
  const home = navSrc.slice(navSrc.indexOf('<HomeStackNav.Navigator'), navSrc.indexOf('</HomeStackNav.Navigator>'));
  expect(home).toMatch(/<HomeStackNav\.Screen name="Messages"\s+component=\{MessagesScreen\} \/>/);
  expect(navSrc).toMatch(/<Tab\.Screen\s+name="Home"/);
});
