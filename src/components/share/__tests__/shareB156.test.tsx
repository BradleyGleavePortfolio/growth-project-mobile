/** SHARE-B (shareSendV1, MOCK-SHARE boards 5, 6 and 8): the card in both threads, the inbox line, and Send through the outbox. */
import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockFlags: Record<string, boolean> = { shareSheetV2: true, shareSendV1: true, c3StyleB: true };
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-A', coach_id: 'coach-1' }) }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { name: 'Sam Rivers' } })), post: jest.fn() } }));
const mockSendCard = jest.fn();
const mockTakeBack = jest.fn();
jest.mock('../../../services/messageOutbox', () => ({
  sendCardViaOutbox: (...a: unknown[]) => mockSendCard(...a),
  takeBackRefused: (...a: unknown[]) => mockTakeBack(...a),
}));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/card.png') }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import ShareSheet, { type ShareCardContent } from '../ShareSheet';
import { bestCard, runCard, sharedCardLabel } from '../shareCards';
import { readShareCard } from '../../../api/shareCardApi';
import MessageBubble from '../../messaging/MessageBubble';
import { StyleBBubble } from '../../messaging/StyleBThread';
import { bubbleV2Fields, inboxLine, messageActionOptions, readThreadV2Fields } from '../../messaging/threadV2';
import type { InboxLastMessage } from '../../../api/messagingV2Api';

const haptic = () => jest.requireMock('../../../ui/haptics/haptics.service').HapticService;
const NetInfo = jest.requireMock('@react-native-community/netinfo');
const SNAP = { kind: 'weigh_in_run', value: 14, words: 'days in a row', from: '2026-10-04', to: '2026-10-17' } as const;
const ROW = { id: 'm1', sender_id: 'client-A', body: null, created_at: '2026-10-18T16:41:00.000Z', card: { card_type: 'share', ref_id: null, snapshot: SNAP } };
const SPOKEN = 'Shared progress: 14 days in a row with a weigh-in, Oct 4 to Oct 17. Long press for actions.';
const bubble = (row: Record<string, unknown> = ROW) => ({ id: 'm1', body: '', created_at: ROW.created_at, ...bubbleV2Fields(readThreadV2Fields(row), 'client-A', null) });
const styleB = (state: 'sent' | 'waiting' | 'failed', onRetry = jest.fn()) => render(
  <StyleBBubble message={{ ...bubble(), pending: state !== 'sent' }} isMe state={state} groupEnd showSent={state === 'sent'} animateIn={false}
    reduceMotion onLongPress={jest.fn()} onRetry={onRetry} />);
const last = (over: Partial<InboxLastMessage>): InboxLastMessage =>
  ({ id: 'm1', sender_id: 'client-A', is_mine: false, kind: 'text', preview: '', created_at: ROW.created_at, edited: false, ...over });
function Host({ card }: { card: ShareCardContent }) {
  const [open, setOpen] = React.useState<ShareCardContent | null>(card);
  return <ShareSheet card={open} onClose={() => setOpen(null)} />;
}
const sheet = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Host card={runCard(14, '2026-10-17', '14')} />
  </QueryClientProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  NetInfo.__reset();
  mockFlags = { shareSheetV2: true, shareSendV1: true, c3StyleB: true };
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn() }) as never);
});
afterEach(() => jest.restoreAllMocks());

it('a thread row keeps a share card it can draw, and nothing else; with the flag off the row is main\'s', () => {
  expect(readThreadV2Fields(ROW).card).toEqual(SNAP);
  const bad = [null, 'share', { card_type: 'workout', snapshot: SNAP }, { card_type: 'share', snapshot: { ...SNAP, kind: 'body_weight' } },
    { card_type: 'share', snapshot: { ...SNAP, value: 0 } }, { card_type: 'share', snapshot: { ...SNAP, to: 'Oct 17' } }, { card_type: 'share', snapshot: { ...SNAP, words: '' } }];
  bad.forEach((card) => expect(readShareCard(card)).toBeUndefined());
  expect(readShareCard({ card_type: 'share', snapshot: { kind: 'recent_best', value: 225, words: 'Back squat', from: 7, to: '2026-10-17' } }))
    .toEqual({ kind: 'recent_best', value: 225, words: 'Back squat', to: '2026-10-17' });
  mockFlags = { ...mockFlags, shareSendV1: false };
  expect(readThreadV2Fields(ROW).card).toBeUndefined();
});

it('boards 5 and 6: the card draws under "Shared progress" on the coach\'s side and the client\'s, and says its facts', async () => {
  const words = ['Shared progress', 'Weigh-ins', '14', 'days in a row', 'Oct 4', 'Oct 17', 'The Growth Project'];
  const coach = await render(<MessageBubble message={bubble()} isMe={false} onLongPress={jest.fn()} />);
  words.forEach((w) => expect(coach.getByText(w)).toBeTruthy());
  expect(coach.getByLabelText(SPOKEN)).toBeTruthy();
  await coach.unmount();
  const client = await styleB('sent');
  words.forEach((w) => expect(client.getByText(w)).toBeTruthy());
  expect([client.getByLabelText(SPOKEN), client.getByText('Sent')]).toBeTruthy();
  await client.unmount();
  const best = bestCard('Back squat', 225, '2026-10-17').snapshot;
  expect(sharedCardLabel(best)).toBe('Shared progress: Back squat, 225 lb, recent best, Saturday, October 17.');
  const gone = await render(<MessageBubble message={bubble({ ...ROW, deleted: true })} isMe={false} onLongPress={jest.fn()} />);
  expect([gone.getByText('Message deleted'), gone.queryByText('Shared progress')]).toEqual([expect.anything(), null]);
});

it('board 8: a card that waits has "Waiting to send"; one that failed is a tap to send again; it has no text to copy', async () => {
  const waiting = await styleB('waiting');
  expect([waiting.getByText('Waiting to send'), waiting.getByLabelText(SPOKEN)]).toBeTruthy();
  await waiting.unmount();
  const onRetry = jest.fn();
  const failed = await styleB('failed', onRetry);
  await fireEvent.press(failed.getByRole('button', { name: 'Not sent. Tap to send again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  const pending = { isMine: true, pending: true, deleted: false, pinned: false, createdAt: ROW.created_at };
  expect(messageActionOptions({ ...pending, hasText: false }).map((o) => o.key)).toEqual(['retry']);
  expect(messageActionOptions({ ...pending, hasText: true }).map((o) => o.key)).toEqual(['retry', 'copy']);
});

it('board 6: an inbox row whose newest message is a card says "Shared a card"; flag off, or with text, as before', () => {
  expect([inboxLine(last({ card_type: 'share' })), inboxLine(last({ card_type: 'share', preview: 'Look' })), inboxLine(last({}))])
    .toEqual(['Shared a card', 'Look', 'Message']);
  mockFlags = { ...mockFlags, shareSendV1: false };
  expect(inboxLine(last({ card_type: 'share' }))).toBe('Message');
});

it('board 8: offline the sheet says it sends on reconnect; Send puts the card in the outbox and closes, with no success haptic', async () => {
  NetInfo.__setState({ isConnected: false, isInternetReachable: false });
  mockSendCard.mockResolvedValueOnce('waiting');
  const s = await sheet();
  expect(await s.findByText("You're offline. It sends when you reconnect.")).toBeTruthy();
  await fireEvent.press(s.getByRole('button', { name: 'Send to Sam' }));
  await waitFor(() => expect(s.queryByText('Share this card')).toBeNull());
  expect(mockSendCard).toHaveBeenCalledWith('client-A', SNAP, expect.any(String));
  expect([haptic().success, haptic().error, jest.requireMock('../../../lib/analytics').track].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
});

it('boards 7 and 9 through the outbox: sent is one success haptic; failed says so and the line sends the same card again', async () => {
  mockSendCard.mockResolvedValueOnce('failed').mockResolvedValueOnce('sent');
  const s = await sheet();
  expect(await s.findByText('Sam sees this card in your messages.')).toBeTruthy();
  await fireEvent.press(s.getByRole('button', { name: 'Send to Sam' }));
  await fireEvent.press(await s.findByRole('button', { name: 'Not sent. Tap to send again' }));
  await waitFor(() => expect(s.queryByText('Share this card')).toBeNull());
  expect([haptic().error.mock.calls.length, haptic().success.mock.calls.length]).toEqual([1, 1]);
  const [first, second] = mockSendCard.mock.calls.map((c) => c[2]);
  expect(second).toBe(first);
  expect(jest.requireMock('../../../lib/analytics').track).toHaveBeenCalledWith(expect.any(String), { card_type: 'streak', destination: 'coach_thread' });
});

// Last: a refusal hides Send until the app restarts (SHARE-A's module flag).
it('a server that refuses the card (400): it leaves the outbox and Send goes away', async () => {
  mockSendCard.mockResolvedValueOnce('refused');
  const s = await sheet();
  await fireEvent.press(await s.findByRole('button', { name: 'Send to Sam' }));
  await waitFor(() => expect(s.queryByRole('button', { name: 'Send to Sam' })).toBeNull());
  expect(mockTakeBack).toHaveBeenCalledWith('client-A', mockSendCard.mock.calls[0][2]);
  await act(async () => undefined);
  expect(s.getByRole('button', { name: 'Share outside the app' })).toBeTruthy();
});
