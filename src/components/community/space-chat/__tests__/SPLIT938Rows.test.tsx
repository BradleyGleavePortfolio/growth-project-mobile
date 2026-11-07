/**
 * SPLIT-938 part 2 (agent 199): round 2's fixes in the row files.
 * LS-938R2 B2: a photo row draws its picture at its shape and its caption, spoken as the inbox's word "Photo"; a photo
 * the server could not sign keeps an empty frame; a text row draws no frame.
 * LS-938R2 B5: a sending voice note draws an upload bar that follows the outbox's progress; no bar once it is not sending.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
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

import SpaceChatRow from '../SpaceChatRow';
import SpaceVoiceNote from '../SpaceVoiceNote';
import type { VoicePlaybackHandle, VoicePlaybackPort } from '../../voicePlaybackPort';

const BASE = { id: 'm-1', name: 'Ana', isCoach: false, createdAt: '2026-11-05T18:00:00Z', authorId: 'u-ana', offline: false };
const wrap = (el: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>
);
const flat = (style: unknown) => StyleSheet.flatten(style as object) as { aspectRatio?: number; width?: string };

describe('LS-938R2 B2: a photo row draws its picture and caption', () => {
  it.each([
    ['signed, wide, with a caption', { url: 'https://signed.example/p.jpg', width: 1600, height: 900 }, 'Morning walk', 1600 / 900, 'Photo. Morning walk'],
    ['signed, very tall, no caption (kept at 1:2)', { url: 'https://signed.example/t.jpg', width: 400, height: 2000 }, null, 0.5, 'Photo'],
    ['not signed (an empty frame), with a caption', null, 'Done', 4 / 3, 'Photo. Done'],
  ] as const)('%s', async (_name, image, body, shape, spoken) => {
    const r = await render(wrap(<SpaceChatRow {...BASE} body={body} image={image} />));
    const frame = r.getByTestId('space-chat-photo-m-1', { includeHiddenElements: true });
    expect(flat(frame.props.style).aspectRatio).toBeCloseTo(shape);
    const picture = r.queryByTestId('space-chat-photo-image-m-1', { includeHiddenElements: true });
    expect(picture?.props.source).toEqual(image?.url ? { uri: image.url } : undefined);
    if (body) expect(r.getByText(body, { includeHiddenElements: true })).toBeTruthy();
    expect(r.getByLabelText(new RegExp(`^Ana, .*\\. ${spoken}$`))).toBeTruthy();
  });

  it('a text row draws no photo frame', async () => {
    const r = await render(wrap(<SpaceChatRow {...BASE} body="Hello" />));
    expect(r.queryByTestId('space-chat-photo-m-1', { includeHiddenElements: true })).toBeNull();
    expect(r.getByLabelText(/^Ana, .*\. Hello$/)).toBeTruthy();
  });
});

describe('LS-938R2 B5: the sending voice note draws its upload', () => {
  const VOICE = { id: 'v-1', duration_ms: 12_000, waveform_peaks: [0.2, 0.5] };
  const port: VoicePlaybackPort = {
    isAvailable: true,
    load: jest.fn(async () => ({
      play: jest.fn(), pause: jest.fn(), seek: jest.fn(), unload: jest.fn().mockResolvedValue(undefined),
    } as unknown as VoicePlaybackHandle)),
  };
  const LOCAL = { voice: VOICE, coach: false, mine: true, offline: false, localUri: 'file:///v-1.m4a', playback: port };

  it('the bar follows progress while sending, and goes when the note is not sending', async () => {
    const r = await render(wrap(<SpaceVoiceNote {...LOCAL} send="sending" progress={0.4} />));
    const width = () => flat(r.getByTestId('space-chat-voice-progress-v-1').props.children.props.style).width;
    expect(width()).toBe('40%');
    expect(r.getByTestId('space-chat-voice-progress-v-1').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
    await r.rerender(wrap(<SpaceVoiceNote {...LOCAL} send="sending" progress={0.85} />));
    expect(width()).toBe('85%');
    await r.rerender(wrap(<SpaceVoiceNote {...LOCAL} send="failed" progress={0.85} />));
    expect(r.queryByTestId('space-chat-voice-progress-v-1')).toBeNull();
    await r.unmount();
  });

  it('the row hands its progress to the note', async () => {
    const r = await render(wrap(
      <SpaceChatRow {...BASE} body={null} voice={VOICE} localUri="file:///v-1.m4a" viewerUserId="u-ana" state="sending" progress={0.5} />,
    ));
    expect(r.getByTestId('space-chat-voice-progress-v-1').props.accessibilityValue.now).toBe(50);
    await r.unmount();
  });
});
