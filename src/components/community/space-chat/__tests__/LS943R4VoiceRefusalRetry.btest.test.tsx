/**
 * LS-943R4 B1: an authoritative refusal invalidates the earlier playable copy, not just the current error.
 * A normal Try again that gets no answer or a temporary error cannot authorize that refused copy again.
 * Real QueryClient and player; only the API, native presentation boundary and playback port are doubled.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
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
import SpaceVoiceNote, { spaceVoiceKey } from '../SpaceVoiceNote';
import type { VoicePlaybackPort } from '../../voicePlaybackPort';

const getOne = communityVoiceApi.getOne as jest.Mock;
const VOICE = { id: 'voice-refused-retry', duration_ms: 12_000, waveform_peaks: [0.2, 0.5] };
const OLD_URL = 'https://signed.example/voice-refused-old.m4a';
const NEW_URL = 'https://signed.example/voice-authorized-new.m4a';
const NOTE = { ...VOICE, url: OLD_URL, heard_at: null };
const key = spaceVoiceKey(VOICE.id);

beforeEach(() => getOne.mockReset());

async function openedThenRefused(status: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handle = {
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    seek: jest.fn().mockResolvedValue(undefined),
    unload: jest.fn().mockResolvedValue(undefined),
  };
  const port: VoicePlaybackPort = { isAvailable: true, load: jest.fn().mockResolvedValue(handle) };
  getOne.mockResolvedValue(NOTE);
  const r = await render(
    <QueryClientProvider client={qc}>
      <SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} playback={port} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(r.getByTestId('voice-player-toggle'));
  await waitFor(() => expect(handle.play).toHaveBeenCalledTimes(1));
  getOne.mockRejectedValue({ status });
  await act(async () => { await qc.refetchQueries({ queryKey: key }); });
  await waitFor(() => expect(handle.unload).toHaveBeenCalledTimes(1));
  expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(true);
  expect(r.queryByTestId(`space-chat-voice-new-${VOICE.id}`)).toBeNull();
  return { r, qc, port, handle };
}

it.each([
  [403, 0], [403, 503], [404, 0], [404, 503],
] as const)(
  'LS943R4 B1: after %s refuses a played copy, Try again with %s must not restore that refused copy',
  async (refused, later) => {
    const { r, qc, port } = await openedThenRefused(refused);
    try {
      const error = { status: later };
      let refuseAgain!: (reason: unknown) => void;
      getOne.mockImplementation(() => new Promise((_resolve, reject) => { refuseAgain = reject; }));
      await fireEvent.press(r.getByTestId(`space-chat-voice-retry-${VOICE.id}`));
      // Observe the loading render first so the following assertions cannot read the previous refusal render.
      await waitFor(() => {
        expect(qc.getQueryState(key)?.fetchStatus).toBe('fetching');
        expect(r.queryByTestId(`space-chat-voice-retry-${VOICE.id}`)).toBeNull();
      });
      await act(async () => { refuseAgain(error); });
      await waitFor(() => {
        expect(qc.getQueryState(key)?.fetchStatus).toBe('idle');
        expect(qc.getQueryState(key)?.error).toBe(error);
        expect(r.getByTestId(`space-chat-voice-retry-${VOICE.id}`)).toBeTruthy();
      });
      // No fresh getOne success has happened since the authoritative refusal.
      await fireEvent.press(r.getByTestId('voice-player-toggle'));
      expect(port.load).toHaveBeenCalledTimes(1);
      expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(true);
      expect(r.queryByTestId(`space-chat-voice-new-${VOICE.id}`)).toBeNull();
      expect(r.queryByTestId(`space-chat-voice-played-${VOICE.id}`)).toBeNull();
    } finally {
      await r.unmount();
      qc.clear();
    }
  },
);

it.each([403, 404])(
  'LS943R4 B1 control: after %s, a successful fresh lookup may authorize its new playable copy',
  async (refused) => {
    const { r, qc, port } = await openedThenRefused(refused);
    try {
      getOne.mockResolvedValue({ ...NOTE, url: NEW_URL });
      await fireEvent.press(r.getByTestId(`space-chat-voice-retry-${VOICE.id}`));
      await waitFor(() => expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(false));
      expect(r.getByTestId(`space-chat-voice-new-${VOICE.id}`)).toBeTruthy();
      await fireEvent.press(r.getByTestId('voice-player-toggle'));
      await waitFor(() => expect(port.load).toHaveBeenLastCalledWith(NEW_URL, expect.anything()));
    } finally {
      await r.unmount();
      qc.clear();
    }
  },
);
