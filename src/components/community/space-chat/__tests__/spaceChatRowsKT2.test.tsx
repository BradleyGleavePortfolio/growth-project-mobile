/**
 * SPLIT-938C (agent 200): the KT-2 proofs of the space chat rows (planning/KNOWN_TRAPS.md KT-2). The rows draw what
 * useSpaceChat hands them (a block, a ban or a departure takes the row there); here, what a row draws for a removal and
 * a refused voice lookup. memberContentAccess.test.tsx registers SpaceChatRow and SpaceVoiceNote with these titles.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
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
import SpaceChatRow from '../SpaceChatRow';
import SpaceVoiceNote from '../SpaceVoiceNote';

const getOne = communityVoiceApi.getOne as jest.Mock;
const BASE = { id: 'm-1', name: 'Ana', isCoach: false, createdAt: '2026-11-05T18:00:00Z', authorId: 'u-ana', offline: false, viewerUserId: 'u-ben' };
const VOICE = { id: 'v-1', duration_ms: 12_000, waveform_peaks: [0.2, 0.5] };
const wrap = (el: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>
);
beforeEach(() => getOne.mockReset());

describe('KT-2: the space chat rows', () => {
  it('KT-2: a row the coach removed draws its one line only: no words, no player, no menu and no lookup of the note', async () => {
    const r = await render(wrap(
      <SpaceChatRow {...BASE} body="words of ana" voice={VOICE} removed={{ who: 'other', text: 'Message removed' }} onBlocked={jest.fn()} />,
    ));
    expect(r.getByLabelText(/^Ana, .*\. Message removed$/)).toBeTruthy();
    expect(r.queryByText('words of ana', { includeHiddenElements: true })).toBeNull();
    expect(r.queryByTestId('space-chat-voice-v-1', { includeHiddenElements: true })).toBeNull();
    expect(r.queryByLabelText(/more|options|report|block/i)).toBeNull();
    expect(getOne).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('KT-2: a voice note whose lookup is refused (403 / 404) draws no New mark and nothing to play, only Try again', async () => {
    getOne.mockRejectedValue({ status: 404 });
    const r = await render(wrap(<SpaceVoiceNote voice={VOICE} coach={false} mine={false} offline={false} />));
    await waitFor(() => expect(r.getByTestId('space-chat-voice-retry-v-1')).toBeTruthy());
    expect(r.queryByTestId('space-chat-voice-new-v-1')).toBeNull();
    expect(r.getByTestId('space-chat-voice-v-1').props.url ?? null).toBeNull();
    await r.unmount();
  });
});
