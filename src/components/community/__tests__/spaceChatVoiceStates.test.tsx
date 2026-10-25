/**
 * FR-871 (SC-M2): the voice card's outbox states, GOAL 03 / 04 / 10a: the sending circle; the clock and
 * Waiting to send with the disc greyed, nothing faded; the failed card with Try again and Delete that asks first.
 * Their own file: a note still on the phone loads its player at once, and that player's async updates
 * (VoiceNotePlayer, FX-848) must not run into another test (see spaceChatVoice.test.tsx).
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

describe('SpaceVoiceNote — outbox states (GOAL 03 / 04 / 10a)', () => {
  const LOCAL = { localUri: 'file:///v-1.m4a', mine: true, coach: false, offline: false };
  it('sending: a circle; waiting: the clock and Waiting to send with the disc greyed, nothing faded', async () => {
    const { Wrapper } = wrap();
    const { p } = port();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} {...LOCAL} send="sending" playback={p} /></Wrapper>);
    expect(r.getByTestId('space-chat-voice-sending-v-1')).toBeTruthy();
    await r.rerender(<Wrapper><SpaceVoiceNote voice={VOICE} {...LOCAL} offline send="waiting" playback={p} /></Wrapper>);
    expect(r.getByText('Waiting to send')).toBeTruthy();
    expect(r.getByTestId('voice-player-toggle').props.accessibilityState).toMatchObject({ disabled: true });
    type Node = { props: { style?: unknown }; parent: Node | null };
    let n: Node | null = r.getByText('Waiting to send') as unknown as Node;
    for (; n; n = n.parent) expect((StyleSheet.flatten(n.props.style as object) as { opacity?: number } | undefined)?.opacity ?? 1).toBe(1);
  });

  it('failed: the red line, Try again, and Delete that asks first', async () => {
    const onRetry = jest.fn();
    const onDiscard = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { Wrapper } = wrap();
    const { p } = port();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} {...LOCAL} send="failed" onRetry={onRetry} onDiscard={onDiscard} playback={p} /></Wrapper>);
    expect(r.getByText('That didn’t send. Your recording is safe — try sending again.')).toBeTruthy();
    await fireEvent.press(r.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await fireEvent.press(r.getByText('Delete'));
    expect(onDiscard).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(alert.mock.calls[0][0]).toBe('Delete this voice note?');
    buttons.find((b) => b.text === 'Delete')?.onPress?.();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });
});
