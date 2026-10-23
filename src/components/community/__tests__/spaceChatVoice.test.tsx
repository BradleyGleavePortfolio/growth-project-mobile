/**
 * SC-M2 (FX-871 PR 2): voice in the space chat. Pins:
 *   - someone else's note shows "New" until it is played to the end, then the heard route is called once and the row
 *     shows "Played"; a note already heard shows "Played"; the viewer's own note and an outbox note show neither;
 *   - the mic opens the record sheet aimed at this space and hands the recording on;
 *   - the space's voice outbox keeps only this space's items and refreshes the space's messages when one leaves.
 */
import React from 'react';
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
jest.mock('../space-chat/spaceChatApi', () => ({ spaceChatApi: { markHeard: jest.fn() } }));
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
import { useSpaceVoiceOutbox } from '../space-chat/useSpaceVoiceOutbox';
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
// The player's own async state updates (VoiceNotePlayer, FX-848) outlive a test: the SpaceVoiceNote cases run last.

describe('SpaceChatMic', () => {
  it('opens the record sheet aimed at this space and hands the recording on', async () => {
    const onSend = jest.fn();
    const r = await render(<SpaceChatMic cohortName="Everyone" onSend={onSend} />);
    const mic = r.getByTestId('space-chat-mic');
    expect(mic.props.accessibilityLabel).toBe('Record a voice note');
    expect(mockSheet).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(mic); });
    expect(mockSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, target: { kind: 'cohort', cohortName: 'Everyone' } }));
    const recording = { uri: 'file:///r.m4a', durationMs: 4000 };
    await act(async () => { (mockSheet.mock.calls[mockSheet.mock.calls.length - 1][0] as { onSend: (x: unknown) => void }).onSend(recording); });
    expect(onSend).toHaveBeenCalledWith(recording);
    expect(mockSheet).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
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
});

describe('SpaceVoiceNote — New / Played', () => {
  it('shows New on an unheard note, tells the server once when it plays to the end, then shows Played', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValue(view(null));
    (spaceChatApi.markHeard as jest.Mock).mockResolvedValue('2026-10-23T18:00:00.000Z');
    const { p, events } = port();
    const { Wrapper } = wrap();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={p} /></Wrapper>);
    expect(await r.findByTestId('space-chat-voice-new-v-1')).toBeTruthy();
    expect(r.getByText('New')).toBeTruthy();
    fireEvent.press(r.getByTestId('voice-player-toggle'));
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
    fireEvent.press(r.getByTestId('voice-player-toggle'));
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
    fireEvent.press(r.getByTestId('voice-player-toggle'));
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
    fireEvent.press(local.getByTestId('voice-player-toggle'));
    await waitFor(() => expect(p.load).toHaveBeenLastCalledWith('file:///v-1.m4a', expect.any(Object)));
    await act(async () => { events[events.length - 1].onEnd?.(); });
    expect(spaceChatApi.markHeard).not.toHaveBeenCalled();
  });
});
