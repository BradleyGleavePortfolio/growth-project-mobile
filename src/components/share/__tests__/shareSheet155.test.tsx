/** SHARE-A (owner #SHARE-SEND op 1): ShareSheet behind shareSheetV2, Send behind shareSendV1. MOCK-SHARE boards 1-4, 7, 9. */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockFlags = { shareSheetV2: true, shareSendV1: true };
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
let mockUser: { coach_id?: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockGet = jest.fn(async () => ({ data: { name: 'Sam Rivers' } }));
const mockPost = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ data: {} }));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: () => mockGet(), post: (...a: unknown[]) => mockPost(...a) } }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/card.png') }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import ShareSheet, { type ShareCardContent } from '../ShareSheet';
import { bestCard, runCard } from '../shareCards';
import { sendShareCard } from '../../../api/shareCardApi';
import WorkoutFinishSummary from '../../../screens/client/active-workout/WorkoutFinishSummary';

const haptic = () => jest.requireMock('../../../ui/haptics/haptics.service').HapticService;
const sharing = () => jest.requireMock('expo-sharing');
const RUN = 'Picture of your card: 14 days in a row with a weigh-in, Oct 4 to Oct 17.';
const FOOT_OUTSIDE = "Opens your phone's share options with a picture of this card.";
const wrap = (node: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
function Host({ card }: { card: ShareCardContent }) {
  const [open, setOpen] = React.useState<ShareCardContent | null>(card);
  return <ShareSheet card={open} onClose={() => setOpen(null)} />;
}
const show = (card = runCard(14, '2026-10-17', '14')) => wrap(<Host card={card} />);
const axiosError = (status: number) => Object.assign(new Error(`status ${status}`), { isAxiosError: true, response: { status } });

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags = { shareSheetV2: true, shareSendV1: true };
  mockUser = { coach_id: 'coach-1' };
});

it('both flags are off in every EAS build profile through the real flag reader', () => {
  const eas = require('../../../../eas.json') as { build: Record<string, { extends?: string; env?: Record<string, string> }> };
  const envOf = (name?: string): Record<string, string> => (name ? { ...envOf(eas.build[name].extends), ...(eas.build[name].env ?? {}) } : {});
  const keys = ['EXPO_PUBLIC_FF_SHARE_SHEET_V2', 'EXPO_PUBLIC_FF_SHARE_SEND_V1'];
  const saved = { ...process.env };
  try {
    for (const name of Object.keys(eas.build)) {
      keys.forEach((k) => (envOf(name)[k] === undefined ? delete process.env[k] : (process.env[k] = envOf(name)[k])));
      jest.isolateModules(() => {
        const real = jest.requireActual('../../../config/featureFlags').featureFlags;
        expect([name, real.shareSheetV2, real.shareSendV1]).toEqual([name, false, false]);
      });
    }
  } finally {
    process.env = saved;
  }
});

it('board 3: the cards hold the number, its words and dates, and say what is in them and what is not', () => {
  const run = runCard(14, '2026-10-17', '14');
  expect([run.label, run.inIt, run.notInIt]).toEqual([
    RUN, 'In this card: your weigh-in run and its dates.', 'Not in it: your weight, your name or anything else.',
  ]);
  expect(run.snapshot).toEqual({ kind: 'weigh_in_run', value: 14, words: 'days in a row', from: '2026-10-04', to: '2026-10-17' });
  const best = bestCard('Back squat', 225, '2026-10-17');
  expect([best.label, best.inIt, best.notInIt]).toEqual([
    'Picture of your card: Back squat, 225 lb, recent best, Saturday, October 17.',
    'In this card: this lift, its weight and the date.',
    'Not in it: your other lifts, your body weight or your name.',
  ]);
  expect(best.snapshot).toEqual({ kind: 'recent_best', value: 225, words: 'Back squat', to: '2026-10-17' });
});

it.each([
  ['coachless', null, true],
  ['coached with Send off', 'coach-1', false],
])('board 2 (%s): one way out, Share outside the app, and no coach read', async (_case, coach, send) => {
  mockUser = coach ? { coach_id: coach } : {};
  mockFlags = { shareSheetV2: true, shareSendV1: send };
  const s = await show();
  [s.getByText('Share this card'), s.getByLabelText(RUN), s.getByText('In this card: your weigh-in run and its dates.'),
    s.getByRole('button', { name: 'Share outside the app' }), s.getByText(FOOT_OUTSIDE)].forEach((n) => expect(n).toBeTruthy());
  expect(s.queryByText(/^Send to/)).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();
  await fireEvent.press(s.getByRole('button', { name: 'Dismiss' }));
  expect(s.queryByText('Share this card')).toBeNull();
});

it('boards 1 and 7: coached, Send to Sam posts the share card and gives one success haptic only when it is sent', async () => {
  let release: (v: unknown) => void = () => undefined;
  mockPost.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  const s = await show();
  await fireEvent.press(await s.findByRole('button', { name: 'Send to Sam' }));
  [s.getByRole('button', { name: 'Share outside the app' }), s.getByText('Sam sees this card in your messages.'),
    s.getByRole('button', { name: 'Sending…' })].forEach((n) => expect(n).toBeTruthy());
  expect(mockPost).toHaveBeenCalledWith('/messages', {
    card: { type: 'share', snapshot: { kind: 'weigh_in_run', value: 14, words: 'days in a row', from: '2026-10-04', to: '2026-10-17' } },
    client_message_id: expect.any(String),
  });
  expect(haptic().success).not.toHaveBeenCalled();
  await act(async () => release({ data: {} }));
  await waitFor(() => expect(s.queryByText('Share this card')).toBeNull());
  expect(haptic().success).toHaveBeenCalledTimes(1);
});

it('board 9: a failed send says so in place; tapping the line sends again with the same key', async () => {
  mockPost.mockRejectedValueOnce(new Error('Network Error'));
  const s = await show();
  await fireEvent.press(await s.findByRole('button', { name: 'Send to Sam' }));
  await fireEvent.press(await s.findByRole('button', { name: 'Not sent. Tap to send again' }));
  await waitFor(() => expect(haptic().success).toHaveBeenCalledTimes(1));
  expect(haptic().error).toHaveBeenCalledTimes(1);
  const [first, second] = mockPost.mock.calls.map((c) => (c[1] as { client_message_id: string }).client_message_id);
  expect(second).toBe(first);
});

it('boards 2, 7 and 9: Share outside the app makes the picture, with no success haptic; a failure is a calm line, never an alert', async () => {
  mockFlags = { shareSheetV2: true, shareSendV1: false };
  let release: (v: unknown) => void = () => undefined;
  jest.requireMock('react-native-view-shot').captureRef.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  const s = await show();
  await fireEvent.press(s.getByRole('button', { name: 'Share outside the app' }));
  expect(s.getByRole('button', { name: 'Making the picture…' })).toBeTruthy();
  await act(async () => release('file:///tmp/card.png'));
  await waitFor(() => expect(sharing().shareAsync).toHaveBeenCalledWith('file:///tmp/card.png', expect.objectContaining({ dialogTitle: 'Share your card' })));
  expect(haptic().success).not.toHaveBeenCalled();
  sharing().shareAsync.mockRejectedValueOnce(new Error('denied'));
  const alert = jest.spyOn(Alert, 'alert');
  await fireEvent.press(await s.findByRole('button', { name: 'Share outside the app' }));
  expect(await s.findByText('The picture could not be made. Try again.')).toBeTruthy();
  expect(haptic().error).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('board 4: the Session summary has a Share link under each record line only with the flag on', async () => {
  const summary = { sets: 18, volume: 12450, exercises: 5, records: [{ name: 'Back squat', weight: 225 }] };
  const props = { styles: { exerciseCard: {} } as never, historyState: 'loaded' as const, elapsed: '52:10' };
  const s = await wrap(<WorkoutFinishSummary summary={summary as never} {...props} />);
  await fireEvent.press(s.getByRole('button', { name: 'Share Back squat at 225 lb' }));
  [s.getByText('Recent best'), s.getByText('The heaviest in your last 50 saved workouts.'),
    s.getByText('In this card: this lift, its weight and the date.')].forEach((n) => expect(n).toBeTruthy());
  await s.unmount();
  const empty = await wrap(<WorkoutFinishSummary summary={{ ...summary, records: [] } as never} {...props} />);
  expect(empty.queryByRole('button', { name: /^Share/ })).toBeNull();
  await empty.unmount();
  mockFlags = { shareSheetV2: false, shareSendV1: false };
  const off = await wrap(<WorkoutFinishSummary summary={summary as never} {...props} />);
  expect(off.queryByRole('button', { name: 'Share Back squat at 225 lb' })).toBeNull();
});

it('sendShareCard: 409 (no current coach) is "not available"; a network error is a failed send', async () => {
  mockPost.mockRejectedValueOnce(axiosError(409)).mockRejectedValueOnce(new Error('Network Error'));
  const snap = runCard(3, '2026-10-17', '3').snapshot;
  expect([await sendShareCard(snap, 'k'), await sendShareCard(snap, 'k')]).toEqual(['unavailable', 'failed']);
});

// Last: a 400 or 409 hides Send for the rest of the app session.
it('a 400 from a server without share cards (or 409, no coach) is "not available": Send goes, Share outside the app stays', async () => {
  mockPost.mockRejectedValueOnce(axiosError(400));
  const s = await show();
  await fireEvent.press(await s.findByRole('button', { name: 'Send to Sam' }));
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(s.queryByRole('button', { name: 'Send to Sam' })).toBeNull());
  expect(s.getByRole('button', { name: 'Share outside the app' })).toBeTruthy();
  expect(s.getByText(FOOT_OUTSIDE)).toBeTruthy();
  expect(haptic().error).not.toHaveBeenCalled();
});
