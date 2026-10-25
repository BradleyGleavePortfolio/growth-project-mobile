/**
 * CommunityVoiceNoteDetail (FR-848R4, LS-848 B1 + C): the single voice note opened from search is never
 * saved to the phone (meta persist false, like the feed), so a restart cannot replay a note whose author
 * was banned; and the player draws the note's real waveform peaks.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockParams = { voiceNoteId: 'vn-1', excerpt: '' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communitySearch: true } }));
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { community_search: true }, isLoading: false, isError: false }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u-viewer' }) }));
jest.mock('../../../components/community', () => ({ ThreadHeader: () => null }));
jest.mock('../../../components/community/SafetyMenu', () => ({ __esModule: true, default: () => null }));
const mockPlayer = jest.fn();
jest.mock('../../../components/community/VoiceNotePlayer', () => ({
  __esModule: true,
  default: (p: Record<string, unknown>) => {
    mockPlayer(p);
    return null;
  },
}));
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: { getOne: (...a: unknown[]) => mockGetOne(...a) },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';

const NOTE = {
  id: 'vn-1',
  author_id: 'u-author',
  url: 'https://signed.example/vn-1.m4a',
  duration_ms: 42_000,
  waveform_peaks: [0.2, 0.7, 0.4],
  created_at: '2026-10-24T10:00:00Z',
};

it('never saves the note to the phone and draws its real peaks', async () => {
  mockGetOne.mockResolvedValue(NOTE);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mockPlayer).toHaveBeenCalled());
  const query = qc.getQueryCache().find({ queryKey: ['community', 'voice-note', 'vn-1'] });
  expect(query?.meta).toMatchObject({ persist: false });
  expect(mockPlayer.mock.calls.at(-1)?.[0]).toMatchObject({ peaks: [0.2, 0.7, 0.4], durationMs: 42_000 });
});

// LO-848R4 B4: the detail's words are GOAL Inter too (kind, time, transcript label and excerpt).
it('every line names a loaded Inter face', async () => {
  const { StyleSheet } = jest.requireActual('react-native');
  mockGetOne.mockResolvedValue(NOTE);
  mockParams.excerpt = 'my squat felt strong today';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, findByTestId } = await render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>,
  );
  await findByTestId('community-voice-detail-excerpt');
  const texts = container.queryAll((n) => n.type === 'Text');
  expect(texts.length).toBeGreaterThan(2);
  for (const t of texts) expect(String(StyleSheet.flatten(t.props.style)?.fontFamily)).toMatch(/^(Inter_|ionicons$)/); // ionicons: icon glyphs
  mockParams.excerpt = '';
});
