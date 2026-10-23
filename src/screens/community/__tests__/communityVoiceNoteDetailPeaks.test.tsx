/**
 * FX-COMM (agent 170): the voice note a coach opens from the inbox draws the
 * note's own loudness bars (waveform_peaks from GET /community/voice-notes/:id),
 * not a flat line, and names the sender (author_name, #C6-NAMES-EVERYWHERE).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, communityVoiceNotes: true },
  };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { voiceNoteId: 'n1' } }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: {} }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1' }),
}));
jest.mock('../../../components/community/SafetyMenu', () => () => null);
const mockPlayer = jest.fn();
jest.mock(
  '../../../components/community/VoiceNotePlayer',
  () => (props: unknown) => {
    mockPlayer(props);
    return null;
  },
);
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: { getOne: (...a: unknown[]) => mockGetOne(...a) },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';

const note = (extra: Record<string, unknown> = {}) => ({
  id: 'n1',
  author_id: 'u1',
  url: 'https://x/n1.m4a',
  duration_ms: 42000,
  created_at: new Date().toISOString(),
  waveform_peaks: [0.2, 0.9, 0.4],
  ...extra,
});

async function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>,
  );
  await screen.findByTestId('community-voice-detail-scroll');
  return screen;
}

beforeEach(() => {
  mockPlayer.mockClear();
  mockGetOne.mockReset();
});

it("passes the note's waveform peaks to the player and names the sender", async () => {
  mockGetOne.mockResolvedValue(note({ author_name: 'Riley Chen' }));
  const { getByText } = await renderDetail();
  const last = mockPlayer.mock.calls.at(-1)?.[0] as
    | { peaks?: number[] }
    | undefined;
  expect(last?.peaks).toEqual([0.2, 0.9, 0.4]);
  expect(getByText('Riley Chen')).toBeTruthy();
});

it('falls back to "Voice note" with no name and an empty bar list with no peaks', async () => {
  mockGetOne.mockResolvedValue(note({ waveform_peaks: null }));
  const { getAllByText } = await renderDetail();
  const last = mockPlayer.mock.calls.at(-1)?.[0] as
    | { peaks?: number[] }
    | undefined;
  expect(last?.peaks).toEqual([]);
  expect(getAllByText('Voice note').length).toBeGreaterThanOrEqual(2);
});
