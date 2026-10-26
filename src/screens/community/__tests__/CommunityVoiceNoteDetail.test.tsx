/**
 * CommunityVoiceNoteDetail (FR-848R4, LS-848 B1 + C): the single voice note opened from search is never
 * saved to the phone (meta persist false, like the feed), so a restart cannot replay a note whose author
 * was banned; and the player draws the note's real waveform peaks.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
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
const mockSafety = jest.fn();
jest.mock('../../../components/community/SafetyMenu', () => ({
  __esModule: true,
  default: (p: Record<string, unknown>) => {
    mockSafety(p);
    return null;
  },
}));
const mockRole = { current: 'client' as string };
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { membership: { role: mockRole.current } } }),
}));
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
import { resetReportedVoiceNotes } from '../../../components/community/VoiceReportedFold';

beforeEach(() => {
  resetReportedVoiceNotes();
  mockRole.current = 'client';
  mockSafety.mockReset();
  mockPlayer.mockReset();
});

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

async function renderDetail() {
  mockGetOne.mockResolvedValue(NOTE);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = await render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mockSafety).toHaveBeenCalled());
  return utils;
}

// LO-848R4 B1 (GOAL B-06b): once reported, the detail folds the note and drops its player.
it('a reported note folds into the VN-07 row and the player is gone', async () => {
  const { findByTestId, getByText } = await renderDetail();
  const safety = mockSafety.mock.calls.at(-1)?.[0] as { onReported: () => void; context: unknown };
  expect(safety.context).toEqual({ name: 'Member', detail: 'voice note · 0:42' });
  mockPlayer.mockReset();
  await act(async () => {
    safety.onReported();
  });
  expect(await findByTestId('community-voice-detail-reported')).toBeTruthy();
  expect(getByText('You reported this voice note. It is hidden for you.')).toBeTruthy();
  expect(mockPlayer).not.toHaveBeenCalled();
});

// LO-848R4 B2 (GOAL B-06c): the workspace coach gets Delete on another member's note; a member does not.
it('offers Delete on another member’s note to the coach only', async () => {
  await renderDetail();
  expect((mockSafety.mock.calls.at(-1)?.[0] as { onDelete?: unknown }).onDelete).toBeUndefined();
  mockSafety.mockReset();
  mockRole.current = 'coach';
  await renderDetail();
  expect(typeof (mockSafety.mock.calls.at(-1)?.[0] as { onDelete?: unknown }).onDelete).toBe('function');
});

// Sol R5-B3: the detail draws a coach's note as the deep coach card, like the Hall; a member's stays light.
it('a coach-author note plays on the coach card; a member note on the light card', async () => {
  mockGetOne.mockResolvedValue({ ...NOTE, author_is_coach: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mockPlayer).toHaveBeenCalled());
  expect(mockPlayer.mock.calls.at(-1)?.[0]).toMatchObject({ tone: 'coach' });
  mockPlayer.mockReset();
  await renderDetail();
  await waitFor(() => expect(mockPlayer).toHaveBeenCalled());
  expect(mockPlayer.mock.calls.at(-1)?.[0]).toMatchObject({ tone: 'light' });
});
