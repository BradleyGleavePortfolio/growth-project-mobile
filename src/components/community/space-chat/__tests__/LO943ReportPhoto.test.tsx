/**
 * FIX-943 (agent 200), LO-943 C4: the report sheet's context line names a photo the way its quote does (LO-943 B1's class):
 * the caption's first line, else the inbox's word "Photo"; a voice note and a text row are as before.
 */
import React from 'react';
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
// The sheet itself is SafetyMenu's (its own suite); this reads the context line the row hands it.
jest.mock('../../SafetyMenu', () => {
  const ReactActual = jest.requireActual('react');
  return { __esModule: true, default: (props: object) => ReactActual.createElement('SafetyMenuHost', props) };
});
jest.mock('../../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn().mockReturnValue(new Promise(() => {})) } }));
jest.mock('../spaceChatApi', () => ({ spaceChatApi: { markHeard: jest.fn() } }));

import SpaceChatRow from '../SpaceChatRow';

const BASE = { id: 'm-1', name: 'Ana', isCoach: false, createdAt: '2026-11-05T18:00:00Z', authorId: 'u-ana', offline: false, viewerUserId: 'u-me' };
const PHOTO = { url: 'https://signed.example/p.jpg', width: 800, height: 600 };
const wrap = (el: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>
);

describe('LO-943 C4: the report sheet names a photo the way the quote does', () => {
  it.each([
    ['a photo with no caption', PHOTO, null, 'Photo'],
    ['a photo the server could not sign, no caption', null, null, 'Photo'],
    ['a photo with a caption (its first line)', PHOTO, 'Morning walk\nby the lake', 'Morning walk'],
    ['a text row (its words)', undefined, 'Same time tomorrow?', 'Same time tomorrow?'],
  ] as const)('%s', async (_name, image, body, detail) => {
    const r = await render(wrap(<SpaceChatRow {...BASE} body={body} image={image} />));
    expect(r.getByTestId('space-chat-menu-m-1').props.context).toEqual({ name: 'Ana', detail });
    await r.unmount();
  });

  it('a voice note keeps its voice line', async () => {
    const voice = { id: 'v-1', duration_ms: 21_000, waveform: [] } as never;
    const r = await render(wrap(<SpaceChatRow {...BASE} body={null} voice={voice} />));
    expect(r.getByTestId('space-chat-menu-m-1').props.context).toEqual({ name: 'Ana', detail: 'voice note · 0:21' });
    await r.unmount();
  });
});
