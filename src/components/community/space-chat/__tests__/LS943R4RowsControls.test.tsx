import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../../../HapticPressable', () => {
  const R = jest.requireActual('react');
  return { __esModule: true, default: ({ children, ...props }: { children?: unknown }) => R.createElement('HapticPressableHost', props, children) };
});
jest.mock('../../SafetyMenu', () => {
  const R = jest.requireActual('react');
  return { __esModule: true, default: (props: object) => R.createElement('SafetyMenuHost', props) };
});
jest.mock('../../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn() } }));
jest.mock('../spaceChatApi', () => ({ spaceChatApi: { markHeard: jest.fn() } }));

import { communityVoiceApi } from '../../../../api/communityVoiceApi';
import { spaceChatApi, type SpaceMessage } from '../spaceChatApi';
import type { SpaceReplyTarget } from '../spaceChatOutbox';
import SpaceChatRow from '../SpaceChatRow';
import SpaceReplyQuote, { firstLine, photoLine, quoteOf, quoteOfTarget, spokenQuote, voiceLine } from '../SpaceReplyQuote';
import SpaceVoiceNote, { spaceVoiceKey } from '../SpaceVoiceNote';
import type { VoicePlaybackPort } from '../../voicePlaybackPort';

const getOne = communityVoiceApi.getOne as jest.Mock;
const markHeard = spaceChatApi.markHeard as jest.Mock;
const VOICE = { id: 'v-ctrl', duration_ms: 21_000, waveform_peaks: [0.2, 0.5] };
const NOTE = { ...VOICE, url: 'https://signed.example/v-ctrl.m4a', heard_at: null };
const BASE = { id: 'm-ctrl', name: 'Ben', isCoach: false, createdAt: '2026-11-05T18:00:00Z', authorId: 'u-ben', offline: false, viewerUserId: 'u-me' };
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
function livePort() {
  const handle = { play: jest.fn().mockResolvedValue(undefined), pause: jest.fn().mockResolvedValue(undefined),
    seek: jest.fn().mockResolvedValue(undefined), unload: jest.fn().mockResolvedValue(undefined) };
  const port: VoicePlaybackPort & { load: jest.Mock } = { isAvailable: true, load: jest.fn().mockResolvedValue(handle) };
  return { handle, port };
}
beforeEach(() => {
  getOne.mockReset().mockResolvedValue(NOTE);
  markHeard.mockReset().mockResolvedValue('2026-11-06T13:55:00Z');
});

it.each([
  ['text', 'text', '\n First line \nSecond line', null, 'First line'],
  ['captioned photo', 'image', '\n Morning walk \nby the lake', null, 'Morning walk'],
  ['captionless photo', 'image', '', null, 'Photo'],
  ['whitespace photo', 'image', ' \n\t', null, 'Photo'],
  ['voice', 'voice', '', 21_000, 'voice note · 0:21'],
] as const)('LS943R4: %s pending and sent quote words agree, including the held row', async (_label, kind, snippet, ms, expected) => {
  const parent = { id: 'parent', kind, snippet, sender_name: 'Ana', voice_duration_ms: ms, gone: false } as SpaceMessage['parent'];
  // The same three branches used by CommunitySpaceChatScreen.tsx:216-229 in part 4.
  const preview = kind === 'voice' ? voiceLine(ms ?? 0) : kind === 'image' ? photoLine(snippet) : firstLine(snippet);
  const pending = quoteOfTarget({ messageId: 'parent', authorId: 'u-ana', authorLabel: 'Ana', body: preview } as SpaceReplyTarget);
  const sent = quoteOf(parent);
  expect(sent).not.toBeNull();
  expect(pending).toMatchObject({ gone: false, name: 'Ana', text: expected });
  expect(sent).toMatchObject({ gone: false, name: 'Ana', text: expected });
  if (kind === 'voice') {
    expect(spokenQuote(pending)).toBe('Replying to Ana: voice note · 0:21. ');
    expect(spokenQuote(sent!)).toBe('Replying to Ana: voice note, 0:21. ');
  } else expect(spokenQuote(pending)).toBe(spokenQuote(sent!));
  const qc = freshClient();
  const r = await render(<QueryClientProvider client={qc}><SpaceChatRow {...BASE} body="Answer" quote={sent!} held /></QueryClientProvider>);
  expect(r.getByText(expected, { includeHiddenElements: true })).toBeTruthy();
  expect(r.getByLabelText(new RegExp(`^Replying to Ana: ${kind === 'voice' ? 'voice note, 0:21' : expected}`))).toBeTruthy();
  await r.unmount();
  qc.clear();
});

it('LS943R4: gone pending and server quotes discard words, have the same spoken line, and cannot jump', async () => {
  const pending = quoteOfTarget({ messageId: 'p', authorLabel: 'Ana', body: 'no longer readable', gone: true } as SpaceReplyTarget);
  const sent = quoteOf({ id: 'p', gone: true, sender_name: 'Ana', snippet: 'no longer readable' } as SpaceMessage['parent']);
  expect(pending).toEqual({ gone: true });
  expect(sent).toEqual(pending);
  expect(spokenQuote(pending)).toBe('Replying to: Message removed. ');
  const r = await render(<SpaceReplyQuote id="gone" quote={pending} onPress={jest.fn()} />);
  expect(r.getByTestId('space-chat-quote-gone', { includeHiddenElements: true }).props.onPress).toBeUndefined();
  expect(r.queryByText('Ana', { includeHiddenElements: true })).toBeNull();
  expect(r.queryByText('no longer readable', { includeHiddenElements: true })).toBeNull();
  await r.unmount();
});

it.each([[-0.5, 0], [0, 0], [0.375, 38], [1, 100], [1.5, 100]])(
  'LS943R4: progress %s keeps visual and spoken percentages at %s', async (progress, expected) => {
    const qc = freshClient();
    const r = await render(<QueryClientProvider client={qc}><SpaceVoiceNote voice={VOICE} coach={false} mine offline={false} localUri="file:///local.m4a" send="sending" progress={progress} /></QueryClientProvider>);
    const bar = r.getByTestId('space-chat-voice-progress-v-ctrl');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: expected });
    const fill = bar.children[0] as { props: { style: { width?: string }[] } };
    expect(StyleSheet.flatten(fill.props.style).width).toBe(`${expected}%`);
    expect(getOne).not.toHaveBeenCalled();
    await r.unmount();
    qc.clear();
  },
);

it.each([[false, null, 'new'], [false, '2026-11-05T18:00:00Z', 'played'], [true, null, 'none']] as const)(
  'LS943R4: mine=%s heard=%s draws only the correct %s mark', async (mine, heard_at, expected) => {
    getOne.mockResolvedValue({ ...NOTE, heard_at });
    const qc = freshClient();
    const { port } = livePort();
    const r = await render(<QueryClientProvider client={qc}><SpaceVoiceNote voice={VOICE} coach={false} mine={mine} offline={false} playback={port} /></QueryClientProvider>);
    await waitFor(() => expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(false));
    expect(!!r.queryByTestId('space-chat-voice-new-v-ctrl')).toBe(expected === 'new');
    expect(!!r.queryByTestId('space-chat-voice-played-v-ctrl')).toBe(expected === 'played');
    await r.unmount();
    qc.clear();
  },
);

it.each([403, 404])('LS943R4: %s also removes an already Played mark and releases its clip', async (status) => {
  getOne.mockResolvedValue({ ...NOTE, heard_at: '2026-11-05T18:00:00Z' });
  const qc = freshClient();
  const { port, handle } = livePort();
  const r = await render(<QueryClientProvider client={qc}><SpaceVoiceNote voice={VOICE} coach mine={false} offline={false} playback={port} /></QueryClientProvider>);
  await waitFor(() => expect(r.getByTestId('space-chat-voice-played-v-ctrl')).toBeTruthy());
  await fireEvent.press(r.getByTestId('voice-player-toggle'));
  await waitFor(() => expect(handle.play).toHaveBeenCalledTimes(1));
  getOne.mockRejectedValue({ status });
  await act(async () => { await qc.refetchQueries({ queryKey: spaceVoiceKey(VOICE.id) }); });
  await waitFor(() => expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(true));
  expect(r.queryByTestId('space-chat-voice-new-v-ctrl')).toBeNull();
  expect(r.queryByTestId('space-chat-voice-played-v-ctrl')).toBeNull();
  expect(handle.unload).toHaveBeenCalledTimes(1);
  await r.unmount();
  qc.clear();
});

it('LS943R4: a completed authorized playback marks Heard once and replaces New with Played', async () => {
  const qc = freshClient();
  const { port } = livePort();
  const r = await render(<QueryClientProvider client={qc}><SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={port} /></QueryClientProvider>);
  await waitFor(() => expect(r.getByTestId('space-chat-voice-new-v-ctrl')).toBeTruthy());
  await fireEvent.press(r.getByTestId('voice-player-toggle'));
  await waitFor(() => expect(port.load).toHaveBeenCalledTimes(1));
  await act(async () => { port.load.mock.calls[0][1].onEnd(); });
  await waitFor(() => expect(r.getByTestId('space-chat-voice-played-v-ctrl')).toBeTruthy());
  expect(r.queryByTestId('space-chat-voice-new-v-ctrl')).toBeNull();
  expect(markHeard).toHaveBeenCalledTimes(1);
  await act(async () => { port.load.mock.calls[0][1].onEnd(); });
  expect(markHeard).toHaveBeenCalledTimes(1);
  await r.unmount();
  qc.clear();
});
