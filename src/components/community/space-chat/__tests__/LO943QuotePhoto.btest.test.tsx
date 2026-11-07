/**
 * LO-943 B1 (Opus lens, m#943 @ bd346621): the server quotes a photo with kind 'image' and its caption as the snippet
 * ('' when it has none; backend community-messages.service.ts view()). A reply's quote of a photo must still say what it
 * answers: the caption, or the inbox's word "Photo" (coachCommunityApi PHOTO_PREVIEW; the screen's pending quote already
 * says it, CommunitySpaceChatScreen replyOf), on the chip and in the row's spoken label.
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
jest.mock('../../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn() } }));
jest.mock('../spaceChatApi', () => ({ spaceChatApi: { markHeard: jest.fn() } }));

import SpaceChatRow from '../SpaceChatRow';
import { quoteOf } from '../SpaceReplyQuote';

const BASE = { id: 'm-2', name: 'Ben', isCoach: false, createdAt: '2026-11-05T18:00:00Z', authorId: 'u-ben', offline: false, body: 'Nice one' };
const wrap = (el: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>
);

it.each([
  ['a photo with no caption', '', 'Photo'],
  ['a photo with a caption', 'Morning walk', 'Morning walk'],
] as const)('LO943 B1: a reply to %s quotes what it answers (%s)', async (_name, snippet, shown) => {
  const quote = quoteOf({
    id: 'p-1', gone: false, kind: 'image', sender_name: 'Ana', snippet, voice_duration_ms: null,
    image: { url: 'https://signed.example/p.jpg', width: 1600, height: 900 },
  } as never);
  const r = await render(wrap(<SpaceChatRow {...BASE} quote={quote} />));
  expect(r.getByText(shown, { includeHiddenElements: true })).toBeTruthy();
  expect(r.getByLabelText(new RegExp(`^Replying to Ana: ${shown}\\. Ben, `))).toBeTruthy();
  await r.unmount();
});
