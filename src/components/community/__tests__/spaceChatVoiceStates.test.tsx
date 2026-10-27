/**
 * FR-871 (SC-M2), FR-871R5: the voice card's outbox states on both cards (member and coach): sending, a circle and the
 * disc greyed (no play until sent); waiting, the circle and a struck wifi spoken "Waiting to send", no sentence (owner
 * 10-20 12:25); the failed card with Try again and Delete that asks first; marks on-deep on the coach card. A row still
 * on the phone has a ••• that deletes it after asking.
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
import SpaceChatRow, { SMALL_GREY } from '../space-chat/SpaceChatRow';
import { forestPop as fp, semantic } from '../../../theme/tokens';
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

describe('SpaceVoiceNote — outbox states (GOAL 03 / 04, owner 10-20 12:25)', () => {
  const LOCAL = { localUri: 'file:///v-1.m4a', mine: true, offline: false };
  const inks = (r: { getByTestId: (id: string) => { props: { color?: string } } }) => [r.getByTestId('space-chat-voice-circle-v-1').props.color];
  type Node = { props: { style?: unknown }; parent: Node | null };
  const unfaded = (node: unknown) => {
    for (let n = node as Node | null; n; n = n.parent) expect((StyleSheet.flatten(n.props.style as object) as { opacity?: number } | undefined)?.opacity ?? 1).toBe(1);
  };
  it.each([[false, SMALL_GREY], [true, fp.onDeep]])('coach %s: sending is a circle and does not play; waiting adds a struck wifi, spoken, no sentence', async (coach, ink) => {
    const { Wrapper } = wrap();
    const { p } = port();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} {...LOCAL} coach={coach} send="sending" playback={p} /></Wrapper>);
    expect(r.getByTestId('space-chat-voice-sending-v-1').props.accessibilityLabel).toBe('Sending…');
    expect(r.getByTestId('voice-player-toggle').props.accessibilityState).toMatchObject({ disabled: true });
    expect(inks(r)).toContain(ink);
    await r.rerender(<Wrapper><SpaceVoiceNote voice={VOICE} {...LOCAL} coach={coach} offline send="waiting" playback={p} /></Wrapper>);
    expect(r.getByLabelText('Waiting to send')).toBeTruthy();
    expect(r.getByTestId('space-chat-voice-wifi-off-v-1')).toBeTruthy();
    expect(r.queryByText('Waiting to send')).toBeNull();
    expect(r.queryByText(/You are offline/)).toBeNull();
    expect(r.getByTestId('voice-player-toggle').props.accessibilityState).toMatchObject({ disabled: true });
    expect(inks(r)).toContain(ink);
    unfaded(r.getByTestId('space-chat-voice-wifi-off-v-1'));
  });

  it.each([false, true])('coach %s failed: the red line (on a light strip on the coach card), Try again, and Delete that asks first', async (coach) => {
    const onRetry = jest.fn();
    const onDiscard = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { Wrapper } = wrap();
    const { p } = port();
    const r = await render(<Wrapper><SpaceVoiceNote voice={VOICE} {...LOCAL} coach={coach} send="failed" onRetry={onRetry} onDiscard={onDiscard} playback={p} /></Wrapper>);
    expect(r.getByText('That didn’t send. Your recording is safe — try sending again.')).toBeTruthy();
    // The failed note still plays from the phone.
    expect(r.getByTestId('voice-player-toggle').props.accessibilityState).toMatchObject({ disabled: false });
    type El = { props: { accessibilityRole?: string; style?: unknown }; parent: El | null };
    let el = r.getByText('That didn’t send. Your recording is safe — try sending again.') as unknown as El | null;
    while (el && el.props.accessibilityRole !== 'alert') el = el.parent;
    const line = StyleSheet.flatten(el?.props.style as object) as { backgroundColor?: string };
    expect(line.backgroundColor).toBe(coach ? semantic.danger.bg : undefined);
    expect((StyleSheet.flatten(r.getByText('Delete').props.style) as { color: string }).color).toBe(coach ? fp.onDeep : fp.n700);
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

describe('SpaceChatRow — a row still on the phone (FR-871R5, m#879 Opus B3 / Sol B4)', () => {
  it.each([['waiting', 'message'], ['failed', 'message']] as const)('%s: ••• deletes it from the phone, after asking', async (state, noun) => {
    const onDiscard = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = await render(
      <SpaceChatRow id="l-1" name="Mia" isCoach={false} createdAt="2026-10-26T10:00:00.000Z" body="Hi" authorId="u-1"
        viewerUserId="u-1" state={state} offline onRetry={jest.fn()} onDiscard={onDiscard} />,
    );
    const more = r.getByTestId('space-chat-local-menu-l-1');
    expect(more.props.accessibilityLabel).toBe(`Delete this ${noun}`);
    await fireEvent.press(more);
    expect(alert.mock.calls[0][0]).toBe(`Delete this ${noun}?`);
    expect(onDiscard).not.toHaveBeenCalled();
    (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Delete')?.onPress?.();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('FR-871R6 (m#879 Opus B3 / Sol B879-3): sending: no •••, its send cannot be called back; the row keeps its place', async () => {
    const r = await render(
      <SpaceChatRow id="l-1" name="Mia" isCoach={false} createdAt="2026-10-26T10:00:00.000Z" body="Hi" authorId="u-1"
        viewerUserId="u-1" state="sending" offline={false} onRetry={jest.fn()} onDiscard={jest.fn()} />,
    );
    expect(r.queryByTestId('space-chat-local-menu-l-1')).toBeNull();
    expect(StyleSheet.flatten(r.getByTestId('space-chat-local-busy-l-1').props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
  });
});
