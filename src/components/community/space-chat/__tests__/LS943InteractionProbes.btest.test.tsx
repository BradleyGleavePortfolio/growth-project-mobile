import React from 'react';
import { Alert, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }) }));
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) => ReactActual.createElement('ModalHost', { ...props, testID: 'probe-modal' }, children),
  };
});
jest.mock('../../../HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) => ReactActual.createElement('HapticPressableHost', props, children),
  };
});
jest.mock('../../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn() } }));
jest.mock('../spaceChatApi', () => ({ spaceChatApi: { markHeard: jest.fn() } }));

import { communityVoiceApi } from '../../../../api/communityVoiceApi';
import SpaceChatRow from '../SpaceChatRow';
import SpaceMessageSheet from '../SpaceMessageSheet';
import SpaceReplyQuote, { quoteOf, quoteOfTarget } from '../SpaceReplyQuote';
import SpaceVoiceNote from '../SpaceVoiceNote';
import { registerVoicePlayback } from '../../voicePlaybackPort';

const BASE = { id: 'message-probe', name: 'A very long member name for a narrow row', isCoach: false, createdAt: '2026-11-05T18:00:00Z', authorId: 'author-a', offline: false, viewerUserId: 'viewer-b' };
const getOne = communityVoiceApi.getOne as jest.Mock;
const originalOS = Platform.OS;
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  registerVoicePlayback(null);
  jest.restoreAllMocks();
});

it.each([
  ['text', { body: 'content no longer held' }],
  ['photo', { body: 'caption no longer held', image: { url: 'https://signed.example/photo.jpg', width: 1200, height: 800 } }],
  ['voice', { body: null, voice: { id: 'voice-probe', duration_ms: 12_000 } }],
  ['quote', { body: 'reply no longer held', quote: { gone: false as const, name: 'Prior author', text: 'parent no longer held' } }],
])('LS943 probe: removal suppresses the %s body, quote, menu and every lookup', async (_kind, extra) => {
  getOne.mockReset();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = await render(
    <QueryClientProvider client={qc}>
      <SpaceChatRow {...BASE} {...extra} removed={{ who: 'other', text: 'Message removed' }} onHold={jest.fn()} onReply={jest.fn()} onCopy={jest.fn()} />
    </QueryClientProvider>,
  );
  expect(r.getByTestId('space-chat-removed-message-probe', { includeHiddenElements: true })).toBeTruthy();
  for (const id of ['space-chat-photo-message-probe', 'space-chat-voice-voice-probe', 'space-chat-quote-message-probe', 'space-chat-menu-message-probe']) {
    expect(r.queryByTestId(id, { includeHiddenElements: true })).toBeNull();
  }
  expect(r.queryByText(/no longer held/, { includeHiddenElements: true })).toBeNull();
  expect(r.queryByTestId('space-chat-hold-message-probe')).toBeNull();
  expect(getOne).not.toHaveBeenCalled();
  await r.unmount();
  qc.clear();
});

it.each(['reply', 'copy'] as const)('LS943 probe: iOS %s waits for dismissal and is called once', async (action) => {
  (Platform as { OS: string }).OS = 'ios';
  const onReply = jest.fn();
  const onCopy = jest.fn();
  const onClose = jest.fn();
  const r = await render(<SpaceMessageSheet onReply={onReply} onCopy={onCopy} onClose={onClose} />);
  const button = r.getByTestId(`space-chat-sheet-${action}`);
  expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
  await fireEvent.press(button);
  expect(onReply).not.toHaveBeenCalled();
  expect(onCopy).not.toHaveBeenCalled();
  const modal = r.getByTestId('probe-modal', { includeHiddenElements: true });
  expect(modal.props.visible).toBe(false);
  await act(async () => { modal.props.onDismiss(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(action === 'reply' ? onReply : onCopy).toHaveBeenCalledTimes(1);
  expect(action === 'reply' ? onCopy : onReply).not.toHaveBeenCalled();
  await r.unmount();
  expect(action === 'reply' ? onReply : onCopy).toHaveBeenCalledTimes(1);
});

it.each(['space-chat-sheet-cancel', 'space-chat-sheet-scrim'])('LS943 probe: Android %s closes without running an action', async (id) => {
  (Platform as { OS: string }).OS = 'android';
  const onReply = jest.fn();
  const onCopy = jest.fn();
  const onClose = jest.fn();
  const r = await render(<SpaceMessageSheet onReply={onReply} onCopy={onCopy} onClose={onClose} />);
  await fireEvent.press(r.getByTestId(id, { includeHiddenElements: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onReply).not.toHaveBeenCalled();
  expect(onCopy).not.toHaveBeenCalled();
  await r.unmount();
});

it('LS943 probe: gone parent payloads have no old text and no quote action', async () => {
  const onPress = jest.fn();
  const quote = quoteOf({ gone: true, snippet: 'old payload', sender_name: 'old author' } as never)!;
  expect(quote).toEqual({ gone: true });
  expect(quoteOfTarget({ gone: true, authorLabel: 'old author', body: 'old payload' } as never)).toEqual({ gone: true });
  const r = await render(<SpaceReplyQuote id="gone" quote={quote} onPress={onPress} />);
  expect(r.getByText('Message removed', { includeHiddenElements: true })).toBeTruthy();
  expect(r.queryByText(/old/, { includeHiddenElements: true })).toBeNull();
  expect(r.getByTestId('space-chat-quote-gone', { includeHiddenElements: true }).props.onPress).toBeUndefined();
  expect(onPress).not.toHaveBeenCalled();
  await r.unmount();
});

const VOICE = { id: 'voice-positive-control', duration_ms: 12_000, waveform_peaks: [0.2, 0.5] };
const handle = () => ({
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn().mockResolvedValue(undefined),
  seek: jest.fn().mockResolvedValue(undefined),
  unload: jest.fn().mockResolvedValue(undefined),
});

it('LS943 probe: a loaded playing row is released when it becomes a removal', async () => {
  const clip = handle();
  registerVoicePlayback({ isAvailable: true, load: jest.fn().mockResolvedValue(clip) });
  getOne.mockResolvedValue({ ...VOICE, url: 'https://signed.example/positive.m4a', heard_at: null });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = (removed = false) => (
    <QueryClientProvider client={qc}>
      <SpaceChatRow {...BASE} body={null} voice={VOICE} removed={removed ? { who: 'other', text: 'Message removed' } : null} />
    </QueryClientProvider>
  );
  const r = await render(row());
  await waitFor(() => expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(r.getByTestId('voice-player-toggle'));
  await waitFor(() => expect(clip.play).toHaveBeenCalledTimes(1));
  await r.rerender(row(true));
  expect(r.queryByTestId(`space-chat-voice-${VOICE.id}`, { includeHiddenElements: true })).toBeNull();
  expect(clip.unload).toHaveBeenCalledTimes(1);
  await r.unmount();
  qc.clear();
});

it.each([403, 404])('LS943 probe: a cold %s refuses the real player and its New mark', async (status) => {
  const clip = handle();
  const load = jest.fn().mockResolvedValue(clip);
  getOne.mockRejectedValue({ status });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = await render(
    <QueryClientProvider client={qc}>
      <SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={{ isAvailable: true, load }} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(r.getByTestId(`space-chat-voice-retry-${VOICE.id}`)).toBeTruthy());
  expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(true);
  expect(r.queryByTestId(`space-chat-voice-new-${VOICE.id}`)).toBeNull();
  expect(load).not.toHaveBeenCalled();
  await r.unmount();
  qc.clear();
});

it.each(['sending', 'waiting'] as const)('LS943 probe: local %s is non-playable without a remote lookup', async (send) => {
  getOne.mockReset();
  const clip = handle();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = await render(
    <QueryClientProvider client={qc}>
      <SpaceVoiceNote voice={VOICE} coach={false} mine offline={send === 'waiting'} send={send} progress={0.4}
        localUri="file:///positive.m4a" playback={{ isAvailable: true, load: jest.fn().mockResolvedValue(clip) }} />
    </QueryClientProvider>,
  );
  expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(true);
  expect(r.getByTestId(`space-chat-voice-${send}-${VOICE.id}`)).toBeTruthy();
  expect(getOne).not.toHaveBeenCalled();
  expect(clip.play).not.toHaveBeenCalled();
  await r.unmount();
  qc.clear();
});

it('LS943 probe: failed local voice can preview and retry; Delete waits for confirmation', async () => {
  getOne.mockReset();
  const clip = handle();
  const onRetry = jest.fn();
  const onDiscard = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = await render(
    <QueryClientProvider client={qc}>
      <SpaceVoiceNote voice={VOICE} coach mine offline={false} send="failed" localUri="file:///positive.m4a"
        playback={{ isAvailable: true, load: jest.fn().mockResolvedValue(clip) }} onRetry={onRetry} onDiscard={onDiscard} />
    </QueryClientProvider>,
  );
  await fireEvent.press(r.getByTestId('voice-player-toggle'));
  await waitFor(() => expect(clip.play).toHaveBeenCalledTimes(1));
  await fireEvent.press(r.getByTestId(`space-chat-retry-${VOICE.id}`));
  expect(onRetry).toHaveBeenCalledTimes(1);
  await fireEvent.press(r.getByTestId(`space-chat-discard-${VOICE.id}`));
  expect(onDiscard).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2]!;
  await act(async () => { buttons.find((b) => b.text === 'Delete')!.onPress?.(); });
  expect(onDiscard).toHaveBeenCalledTimes(1);
  expect(getOne).not.toHaveBeenCalled();
  await r.unmount();
  qc.clear();
});
