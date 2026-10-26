/**
 * CommunityVoiceNoteDetail (FR-848R4, LS-848 B1 + C): the single voice note opened from search is never
 * saved to the phone (meta persist false, like the feed), so a restart cannot replay a note whose author
 * was banned; and the player draws the note's real waveform peaks.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockParams = { voiceNoteId: 'vn-1', excerpt: '' };
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
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
const mockRemoveNote = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: {
    getOne: (...a: unknown[]) => mockGetOne(...a),
    remove: (...a: unknown[]) => mockRemoveNote(...a),
  },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';
import { resetReportedVoiceNotes } from '../../../components/community/VoiceReportedFold';

beforeEach(() => {
  resetReportedVoiceNotes();
  mockRole.current = 'client';
  mockSafety.mockReset();
  mockPlayer.mockReset();
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockRemoveNote.mockReset().mockResolvedValue({ deleted: true });
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
  // REMOVED-BY-M item 1 (owner #174-4): the folded note keeps its menu, told it was reported.
  expect(mockSafety.mock.calls.at(-1)?.[0]).toMatchObject({ targetId: 'vn-1', reported: true });
});

// REMOVED-BY-M item 2 (owner #174-4): the coach and the platform owner get Remove for everyone on another
// member's note (asked in the menu's sheet), not the author's Delete; a member gets neither.
it('offers Remove for everyone on another member’s note to the coach and the owner only', async () => {
  type P = { onDelete?: unknown; onRemove?: unknown; reported?: boolean };
  await renderDetail();
  expect(mockSafety.mock.calls.at(-1)?.[0] as P).toMatchObject({ onDelete: undefined, onRemove: undefined, reported: false });
  for (const role of ['coach', 'owner']) {
    mockSafety.mockReset();
    mockRole.current = role;
    await renderDetail();
    const p = mockSafety.mock.calls.at(-1)?.[0] as P;
    expect(typeof p.onRemove).toBe('function');
    expect(p.onDelete).toBeUndefined();
  }
});

// REMOVED-BY-M item 3 (owner #174-4; backend #1165 CONTRACT §1): the page of a coach-removed note shows one
// quiet line in place of the player: no menu, no player, no transcript.
describe('a coach-removed note on its page (REMOVED-BY-M)', () => {
  const REMOVED = {
    ...NOTE,
    url: null,
    duration_ms: 0,
    waveform_peaks: null,
    removed_at: '2026-10-25T23:40:00Z',
    removed_by: { role: 'coach', user_id: 'u-coach', name: 'Sam' },
  };
  const renderPage = async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = await render(
      <QueryClientProvider client={qc}>
        <CommunityVoiceNoteDetail />
      </QueryClientProvider>,
    );
    return { ...utils, qc };
  };

  it('everyone else reads Removed by Coach {name}; no menu, player or transcript', async () => {
    mockParams.excerpt = 'my squat felt strong today';
    mockGetOne.mockResolvedValue(REMOVED);
    const { findByTestId, getByText, queryByTestId } = await renderPage();
    expect(await findByTestId('community-voice-detail-removed')).toBeTruthy();
    expect(getByText('Removed by Coach Sam')).toBeTruthy();
    expect(mockSafety).not.toHaveBeenCalled();
    expect(mockPlayer).not.toHaveBeenCalled();
    expect(queryByTestId('community-voice-detail-excerpt')).toBeNull();
    expect(queryByTestId('community-voice-detail-removed-safety')).toBeNull();
    mockParams.excerpt = '';
  });

  it('the author reads Your coach removed your voice note and can open Community safety', async () => {
    mockGetOne.mockResolvedValue({ ...REMOVED, author_id: 'u-viewer' });
    const { findByText, getByTestId } = await renderPage();
    expect(await findByText('Your coach removed your voice note')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('community-voice-detail-removed-safety'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySafety');
  });

  it('the coach removes it from the page and stays, reading You removed this voice note', async () => {
    mockRole.current = 'coach';
    mockGetOne.mockResolvedValue(NOTE);
    const { findByText } = await renderPage();
    await waitFor(() => expect(mockSafety).toHaveBeenCalled());
    const { onRemove } = mockSafety.mock.calls.at(-1)?.[0] as { onRemove: () => Promise<void> };
    mockGetOne.mockResolvedValue({ ...REMOVED, removed_by: { role: 'coach', user_id: 'u-viewer', name: 'Sam' } });
    await act(async () => {
      await onRemove();
    });
    expect(mockRemoveNote).toHaveBeenCalledWith('vn-1');
    expect(await findByText('You removed this voice note')).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
