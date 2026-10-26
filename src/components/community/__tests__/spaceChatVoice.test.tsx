/**
 * SC-M2 (FX-871 PR 2): voice in the space chat. Pins:
 *   - someone else's note shows "New" until it is played to the end, then the heard route is called once and the row
 *     shows "Played"; a note already heard shows "Played"; the viewer's own note and an outbox note show neither;
 *   - the mic opens the record sheet aimed at this space and hands the recording on;
 *   - the space's voice outbox keeps only this space's items and refreshes the space's messages when one leaves.
 * FR-871: the 08a first-use card before the first recording (per person, from the server's answer); an outbox note's
 * place in the stream is the time it went in (across a remount and midnight); a failed play gets a fresh URL; the
 * outbox states (sending circle, Waiting to send, the failed card); the New pill and Played metrics.
 */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../../HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) => ReactActual.createElement('HapticPressableHost', props, children),
  };
});
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn() } }));
jest.mock('../space-chat/spaceChatApi', () => ({ spaceChatApi: { markHeard: jest.fn(), getVoiceConsent: jest.fn(), recordVoiceConsent: jest.fn() } }));
const mockSheet = jest.fn();
jest.mock('../VoiceRecordSheet', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockSheet(props);
    return null;
  },
}));
const mockOutbox = { items: [] as unknown[], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockOutbox }));
jest.mock('../space-chat/useSpaceChat', () => ({
  spaceChatKey: (u: string, c: string) => ['community', 'space-chat', u, c],
}));

import SpaceVoiceNote from '../space-chat/SpaceVoiceNote';
import SpaceChatMic from '../space-chat/SpaceChatMic';
import { enqueuedAt, useSpaceVoiceOutbox } from '../space-chat/useSpaceVoiceOutbox';
import { communityVoiceApi } from '../../../api/communityVoiceApi';
import { spaceChatApi } from '../space-chat/spaceChatApi';
import type { VoicePlaybackEvents, VoicePlaybackHandle, VoicePlaybackPort } from '../voicePlaybackPort';

const VOICE = { id: 'v-1', duration_ms: 12_000, waveform_peaks: [0.2, 0.5] };

function port() {
  const events: VoicePlaybackEvents[] = [];
  const p: VoicePlaybackPort = {
    isAvailable: true,
    load: jest.fn(async (_url: string, ev: VoicePlaybackEvents) => {
      events.push(ev);
      return {
        play: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn().mockResolvedValue(undefined),
        seek: jest.fn().mockResolvedValue(undefined),
        unload: jest.fn().mockResolvedValue(undefined),
      } as jest.Mocked<VoicePlaybackHandle>;
    }),
  };
  return { p, events };
}

function wrap(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { qc, Wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
}

const view = (heard_at: string | null) => ({
  id: 'v-1', url: 'https://signed.example/a.m4a', heard_at, duration_ms: 12_000,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOutbox.items = [];
});
// RNTL 14: fireEvent, render, rerender and unmount are async and are always awaited (an unawaited one overlaps the next act).
// The player's own async state updates (VoiceNotePlayer, FX-848) outlive a test: the SpaceVoiceNote cases run last.

describe('SpaceChatMic', () => {
  const consent = spaceChatApi.getVoiceConsent as jest.Mock;
  const mic = (Wrapper: React.ComponentType<{ children: React.ReactNode }>, userId = 'u-1', coach = false, onSend = jest.fn()) =>
    render(<Wrapper><SpaceChatMic cohortName="Everyone" userId={userId} coach={coach} onSend={onSend} /></Wrapper>);
  const sheetOpen = () => mockSheet.mock.calls.some(([p]) => (p as { visible: boolean }).visible);

  it('opens the record sheet aimed at this space and hands the recording on', async () => {
    consent.mockResolvedValue({ seen: true, seen_at: '2026-10-20T10:00:00.000Z' });
    const onSend = jest.fn();
    const r = await mic(wrap().Wrapper, 'u-1', false, onSend);
    const mic1 = r.getByTestId('space-chat-mic');
    expect(mic1.props.accessibilityLabel).toBe('Record a voice note');
    expect(mockSheet).not.toHaveBeenCalled();
    await fireEvent.press(mic1);
    expect(r.queryByTestId('space-chat-voice-first-use')).toBeNull();
    expect(mockSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, target: { kind: 'cohort', cohortName: 'Everyone' } }));
    const recording = { uri: 'file:///r.m4a', durationMs: 4000 };
    await act(async () => { (mockSheet.mock.calls[mockSheet.mock.calls.length - 1][0] as { onSend: (x: unknown) => void }).onSend(recording); });
    expect(onSend).toHaveBeenCalledWith(recording);
    expect(mockSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  });

  it('first time: the 08a card, not the sheet; Not now closes it with no sheet (no phone ask); Record stores it and opens the sheet', async () => {
    consent.mockResolvedValue({ seen: false, seen_at: null });
    (spaceChatApi.recordVoiceConsent as jest.Mock).mockResolvedValue({ seen: true, seen_at: '2026-10-25T10:00:00.000Z' });
    const r = await mic(wrap().Wrapper);
    await waitFor(() => expect(consent).toHaveBeenCalledTimes(1));
    await fireEvent.press(r.getByTestId('space-chat-mic'));
    expect(r.getByText('Voice notes')).toBeTruthy();
    expect(r.getByText('Everyone in Everyone can hear this voice note.')).toBeTruthy();
    expect(r.getByText('If someone reports a voice note, your coach and the TGP Fitness team can listen to it.')).toBeTruthy();
    expect(r.getByText('You can delete your voice note at any time.')).toBeTruthy();
    await fireEvent.press(r.getByLabelText('Not now'));
    expect(r.queryByTestId('space-chat-voice-first-use')).toBeNull();
    expect(sheetOpen()).toBe(false);
    expect(spaceChatApi.recordVoiceConsent).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('space-chat-mic'));
    type El = { props: { onDismiss?: () => void }; parent: El | null };
    let modal = r.getByTestId('space-chat-voice-first-use') as unknown as El | null;
    while (modal && !modal.props.onDismiss) modal = modal.parent;
    const onDismiss = modal?.props.onDismiss;
    await fireEvent.press(r.getByTestId('space-chat-voice-first-use-record'));
    expect(spaceChatApi.recordVoiceConsent).toHaveBeenCalledTimes(1);
    expect(r.queryByTestId('space-chat-voice-first-use')).toBeNull();
    // FR-871R5 (Opus C5): iOS shows one Modal at a time, so the record sheet waits until the card has gone.
    expect(sheetOpen()).toBe(false);
    await act(async () => { onDismiss?.(); });
    expect(mockSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
    await act(async () => { (mockSheet.mock.calls[mockSheet.mock.calls.length - 1][0] as { onClose: () => void }).onClose(); });
    await fireEvent.press(r.getByTestId('space-chat-mic'));
    expect(r.queryByTestId('space-chat-voice-first-use')).toBeNull();
    expect(mockSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }));
  });

  it('a tap before the answer waits for it; a failed answer shows the card; the answer is kept per person; a coach has no report line', async () => {
    let answer: (v: unknown) => void = () => undefined;
    consent.mockImplementationOnce(() => new Promise((res) => { answer = res; }));
    const { Wrapper } = wrap();
    const a = await mic(Wrapper, 'u-1');
    await fireEvent.press(a.getByTestId('space-chat-mic'));
    expect(sheetOpen()).toBe(false);
    expect(a.queryByTestId('space-chat-voice-first-use')).toBeNull();
    await act(async () => { answer({ seen: true, seen_at: '2026-10-20T10:00:00.000Z' }); });
    await waitFor(() => expect(mockSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true })));
    await a.unmount();
    consent.mockRejectedValueOnce(new Error('HTTP 500'));
    const b = await mic(Wrapper, 'u-2', true);
    await waitFor(() => expect(consent).toHaveBeenCalledTimes(2));
    await fireEvent.press(b.getByTestId('space-chat-mic'));
    expect(await b.findByTestId('space-chat-voice-first-use')).toBeTruthy();
    expect(b.queryByText(/If someone reports a voice note/)).toBeNull();
  });
});

describe('useSpaceVoiceOutbox', () => {
  const item = (id: string, cohortId: string, status = 'sending') => ({
    id, authorId: 'u-1', workspaceId: 'w-1', peaks: [0.3], status,
    input: { uri: `file:///${id}.m4a`, durationMs: 3000, cohortId },
  });

  it('keeps this space’s items, sends with this space, and refreshes the messages when an item leaves', async () => {
    mockOutbox.items = [item('a', 'c-1'), item('b', 'c-2')];
    const { qc, Wrapper } = wrap();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    const { result, rerender } = await renderHook(() => useSpaceVoiceOutbox('w-1', 'u-1', 'c-1'), { wrapper: Wrapper });
    expect(result.current.rows.map((x) => x.v.id)).toEqual(['a']);
    const at = result.current.rows[0].at;
    result.current.send({ uri: 'file:///n.m4a', durationMs: 2000 } as never);
    expect(mockOutbox.send).toHaveBeenCalledWith(expect.any(Object), { cohortId: 'c-1' });

    mockOutbox.items = [item('a', 'c-1', 'failed'), item('b', 'c-2')];
    await rerender({});
    expect(result.current.rows[0].v.status).toBe('failed');
    expect(result.current.rows[0].at).toBe(at);
    expect(spy).not.toHaveBeenCalled();

    mockOutbox.items = [item('b', 'c-2')];
    await rerender({});
    expect(result.current.rows).toEqual([]);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['community', 'space-chat', 'u-1', 'c-1'] });
  });

  it('Sol B4: a row keeps the time it went into the outbox, after a remount and past midnight', async () => {
    const before = Date.parse('2026-10-22T23:58:00.000Z');
    mockOutbox.items = [item(`local-${before}-1`, 'c-1', 'waiting'), item(`local-${before + 60_000}-2`, 'c-1', 'failed')];
    jest.useFakeTimers({ now: new Date('2026-10-23T00:05:00.000Z'), doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const { Wrapper } = wrap();
      const first = await renderHook(() => useSpaceVoiceOutbox('w-1', 'u-1', 'c-1'), { wrapper: Wrapper });
      expect(first.result.current.rows.map((x) => x.at)).toEqual(['2026-10-22T23:58:00.000Z', '2026-10-22T23:59:00.000Z']);
      await first.unmount();
      jest.setSystemTime(new Date('2026-10-23T09:00:00.000Z'));
      const again = await renderHook(() => useSpaceVoiceOutbox('w-1', 'u-1', 'c-1'), { wrapper: Wrapper });
      expect(again.result.current.rows.map((x) => x.at)).toEqual(['2026-10-22T23:58:00.000Z', '2026-10-22T23:59:00.000Z']);
    } finally {
      jest.useRealTimers();
    }
    expect(enqueuedAt('vo-9', '2026-10-23T09:00:00.000Z')).toBe('2026-10-23T09:00:00.000Z');
  });
});

describe('SpaceVoiceNote — New / Played', () => {
  it('New pill and Played: 05b metrics (4 x 9 inside the moss edge; none on the coach card; 500 13 pt Played)', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValue(view(null));
    const { Wrapper } = wrap();
    const { p } = port();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={p} /></Wrapper>);
    const pill = StyleSheet.flatten((await r.findByTestId('space-chat-voice-new-v-1')).props.style);
    expect([pill.paddingHorizontal + pill.borderWidth, pill.borderRadius, pill.borderColor]).toEqual([9, 999, '#4E7A3F']);
    expect(StyleSheet.flatten(r.getByText('New').props.style)).toMatchObject({ fontSize: 12, fontWeight: '600', letterSpacing: 0 });
    const coach = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach mine={false} offline={false} playback={p} /></Wrapper>);
    expect(StyleSheet.flatten(coach.getByTestId('space-chat-voice-new-v-1').props.style)).toMatchObject({ borderWidth: 0, paddingHorizontal: 9 });
  });

  it('Sol B3: a play that fails (the signed URL ran out) gets a fresh URL; a failed lookup has Try again', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValueOnce({ ...view(null), url: 'https://signed.example/old.m4a' })
      .mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValueOnce({ ...view(null), url: 'https://signed.example/new.m4a' });
    const { p, events } = port();
    const { Wrapper } = wrap();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={p} /></Wrapper>);
    await r.findByTestId('space-chat-voice-new-v-1');
    await fireEvent.press(r.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(p.load).toHaveBeenLastCalledWith('https://signed.example/old.m4a', expect.any(Object)));
    await act(async () => { events[events.length - 1].onError?.(new Error('403 expired')); });
    await fireEvent.press(await r.findByTestId('space-chat-voice-retry-v-1'));
    await waitFor(() => expect(communityVoiceApi.getOne).toHaveBeenCalledTimes(3));
    // The fresh URL has reached the card (Try again is gone) before the next tap.
    await waitFor(() => expect(r.queryByTestId('space-chat-voice-retry-v-1')).toBeNull());
    await fireEvent.press(r.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(p.load).toHaveBeenLastCalledWith('https://signed.example/new.m4a', expect.any(Object)));
  });

  it('shows New on an unheard note, tells the server once when it plays to the end, then shows Played', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValue(view(null));
    (spaceChatApi.markHeard as jest.Mock).mockResolvedValue('2026-10-23T18:00:00.000Z');
    const { p, events } = port();
    const { Wrapper } = wrap();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={p} /></Wrapper>);
    expect(await r.findByTestId('space-chat-voice-new-v-1')).toBeTruthy();
    expect(r.getByText('New')).toBeTruthy();
    await fireEvent.press(r.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(events.length).toBe(1));
    await act(async () => { events[0].onEnd?.(); });
    await act(async () => { events[0].onEnd?.(); });
    expect(spaceChatApi.markHeard).toHaveBeenCalledTimes(1);
    expect(spaceChatApi.markHeard).toHaveBeenCalledWith('v-1');
    expect(await r.findByTestId('space-chat-voice-played-v-1')).toBeTruthy();
    expect(r.getByText('Played')).toBeTruthy();
    expect(r.queryByText('New')).toBeNull();
  });

  it('shows Played on a note already heard and never calls the heard route again', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValue(view('2026-10-22T09:00:00.000Z'));
    const { p, events } = port();
    const { Wrapper } = wrap();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach mine={false} offline={false} playback={p} /></Wrapper>);
    expect(await r.findByTestId('space-chat-voice-played-v-1')).toBeTruthy();
    await fireEvent.press(r.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(events.length).toBe(1));
    await act(async () => { events[0].onEnd?.(); });
    expect(spaceChatApi.markHeard).not.toHaveBeenCalled();
  });

  it('keeps New when the heard call fails, so the next full play tries again', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValue(view(null));
    (spaceChatApi.markHeard as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('2026-10-23T18:01:00.000Z');
    const { p, events } = port();
    const { Wrapper } = wrap();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={p} /></Wrapper>);
    await r.findByTestId('space-chat-voice-new-v-1');
    await fireEvent.press(r.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(events.length).toBe(1));
    await act(async () => { events[0].onEnd?.(); });
    expect(r.getByTestId('space-chat-voice-new-v-1')).toBeTruthy();
    await act(async () => { events[0].onEnd?.(); });
    expect(spaceChatApi.markHeard).toHaveBeenCalledTimes(2);
    expect(await r.findByTestId('space-chat-voice-played-v-1')).toBeTruthy();
  });

  it('marks neither the viewer’s own note nor a note still on the phone', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValue(view(null));
    const { p, events } = port();
    const { Wrapper } = wrap();
    const own = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach={false} mine offline={false} playback={p} /></Wrapper>);
    await waitFor(() => expect(communityVoiceApi.getOne).toHaveBeenCalled());
    expect(own.queryByText('New')).toBeNull();
    expect(own.queryByText('Played')).toBeNull();
    own.unmount();
    (communityVoiceApi.getOne as jest.Mock).mockClear();
    const local = await render(
      <Wrapper><SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline localUri="file:///v-1.m4a" playback={p} /></Wrapper>,
    );
    expect(communityVoiceApi.getOne).not.toHaveBeenCalled();
    expect(local.queryByText('New')).toBeNull();
    await fireEvent.press(local.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(p.load).toHaveBeenLastCalledWith('file:///v-1.m4a', expect.any(Object)));
    await act(async () => { events[events.length - 1].onEnd?.(); });
    expect(spaceChatApi.markHeard).not.toHaveBeenCalled();
  });
});

