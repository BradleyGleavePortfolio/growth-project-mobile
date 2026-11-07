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
const VOICE = { id: 'voice-held', duration_ms: 12_000, waveform_peaks: [0.2, 0.5] };
const NOTE = { ...VOICE, url: 'https://signed.example/voice-held.m4a', heard_at: null };

beforeEach(() => getOne.mockReset());

it.each([403, 404])(
  'LS943 B1: a voice lookup refused with %s after success stops the cached clip and offers no playable copy',
  async (status) => {
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
    try {
      await waitFor(() => expect(r.getByTestId('voice-player-toggle').props.accessibilityState.disabled).toBe(false));
      await fireEvent.press(r.getByTestId('voice-player-toggle'));
      await waitFor(() => expect(handle.play).toHaveBeenCalledTimes(1));
      getOne.mockRejectedValue({ status });
      await act(async () => {
        await qc.refetchQueries({ queryKey: spaceVoiceKey(VOICE.id) });
      });
      await waitFor(() => expect(r.getByTestId(`space-chat-voice-retry-${VOICE.id}`)).toBeTruthy());
      // The real player must release the previously authorized clip, not keep Pause or its signed URL alive.
      await waitFor(() => expect(handle.unload).toHaveBeenCalledTimes(1));
      expect(r.queryByTestId(`space-chat-voice-new-${VOICE.id}`)).toBeNull();
      expect(r.queryByTestId(`space-chat-voice-played-${VOICE.id}`)).toBeNull();
      const toggle = r.queryByTestId('voice-player-toggle');
      if (toggle) expect(toggle.props.accessibilityState.disabled).toBe(true);
    } finally {
      await r.unmount();
      qc.clear();
    }
  },
);
