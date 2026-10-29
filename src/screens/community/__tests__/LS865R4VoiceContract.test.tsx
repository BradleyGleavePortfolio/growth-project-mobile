/**
 * LS-865R4 B1: the workspace's coach has no membership row in GET /community/me.
 * Inbox -> voice note -> menu must still offer Remove for everyone, under owner #174-4.
 * This is the server's normal coach response, not a missing or still-loading Me.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { communityVoiceNotes: true, communitySearch: false },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { voiceNoteId: 'note-1' } }),
  useFocusEffect: () => undefined,
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: {} }),
}));
let mockRole: 'coach' | 'owner' | 'student' = 'coach';
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: mockRole }),
}));
let mockMe: Record<string, unknown>;
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: mockMe }),
}));
jest.mock('../../../components/community', () => ({ ThreadHeader: () => null }));
jest.mock('../../../components/HapticPressable', () => ({
  __esModule: true,
  default: ({ children, ...props }: { children?: unknown }) =>
    require('react').createElement('HapticPressableHost', props, children),
}));
const mockSafety = jest.fn();
jest.mock('../../../components/community/SafetyMenu', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockSafety(props);
    return null;
  },
}));
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: {
    getOne: (...args: unknown[]) => mockGetOne(...args),
    remove: jest.fn(async () => ({ deleted: true })),
  },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';
import VoiceNotePlayer from '../../../components/community/VoiceNotePlayer';

const NOTE = {
  id: 'note-1',
  workspace_id: 'workspace-1',
  cohort_id: 'space-1',
  conversation_id: null,
  author_id: 'client-1',
  author_name: 'Riley Chen',
  author_is_coach: false,
  url: 'https://signed.example/note-1.m4a',
  duration_ms: 42_000,
  bytes: 4096,
  mime_type: 'audio/mp4',
  has_waveform: true,
  waveform_peaks: [0.2, 0.8, 0.4],
  created_at: '2026-10-29T02:00:00.000Z',
  heard_at: null,
};

beforeEach(() => {
  mockRole = 'coach';
  mockMe = {
    feature_flag_state: 'enabled',
    workspace_id: 'workspace-1',
    membership: null,
    unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
    flags: { community_api: true },
  };
  mockGetOne.mockReset().mockResolvedValue(NOTE);
  mockSafety.mockClear();
});

async function openNote() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>,
  );
  await view.findByTestId('community-voice-detail-scroll');
  await waitFor(() => expect(mockSafety).toHaveBeenCalled());
  return view;
}

describe('LS-865R4 B1: normal coach identity at the new coach-inbox destination', () => {
  it.each(['coach', 'owner'] as const)(
    '%s with an owned workspace and no membership still gets Remove for everyone',
    async (role) => {
      mockRole = role;
      await openNote();
      const safety = mockSafety.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(safety.authorUserId).toBe('client-1');
      expect(safety.viewerUserId).toBe('coach-1');
      expect(safety.onDelete).toBeUndefined();
      expect(safety.onRemove).toEqual(expect.any(Function));
    },
  );

  it('does not give a normal client the coach removal action', async () => {
    mockRole = 'student';
    mockMe = { ...mockMe, membership: { id: 'member-1', role: 'client' } };
    await openNote();
    const safety = mockSafety.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(safety.onRemove).toBeUndefined();
  });
});

describe('LS-865R4 B2: Voice B heard status uses approved SC-M2-N1/N2 words', () => {
  // GET /voice-notes/:id already returns heard_at for this listener. #175-W approved
  // "New" and check icon + "Played"; this is not a pending wording decision.
  it('shows New for the listener whose heard_at is null', async () => {
    const view = await openNote();
    expect(view.queryByText('New')).not.toBeNull();
    expect(view.queryByText('Played')).toBeNull();
  });

  it('shows Played rather than New when the server says this listener heard it', async () => {
    mockGetOne.mockResolvedValue({ ...NOTE, heard_at: '2026-10-29T02:15:00.000Z' });
    const view = await openNote();
    expect(view.queryByText('Played')).not.toBeNull();
    expect(view.queryByText('New')).toBeNull();
  });
});

describe('LS-865R4 B3: the new under-name wrapper must leave room for its real waveform', () => {
  const number = (value: unknown) => typeof value === 'number' ? value : 0;
  it.each([320, 360, 390])('keeps the waveform inside the seek/card bounds at %i pt', async (width) => {
    const view = await openNote();
    const content = StyleSheet.flatten(view.getByTestId('community-voice-detail-scroll').props.contentContainerStyle);
    const playerComponent = view.UNSAFE_getByType(VoiceNotePlayer);
    const indent = StyleSheet.flatten(playerComponent.parent?.props.style);
    const player = view.getByTestId('community-voice-detail-player');
    const card = StyleSheet.flatten(player.props.style);
    const disc = StyleSheet.flatten(view.getByTestId('voice-player-toggle').props.style);
    const browNode = player.children[0];
    if (typeof browNode === 'string') throw new Error('Expected the player brow');
    const brow = StyleSheet.flatten(browNode.props.style);
    const waveform = view.getByTestId('voice-waveform');
    const strip = StyleSheet.flatten(waveform.props.style);
    // Yoga/CSS cannot shrink the 1 pt border on either side of each bar. The
    // real component's minimum strip is those borders plus its real row gaps.
    const barBorders = waveform.children.reduce((sum, bar) => {
      if (typeof bar === 'string') return sum;
      const style = StyleSheet.flatten(bar.props.style);
      return sum + number(style.borderLeftWidth ?? style.borderWidth) +
        number(style.borderRightWidth ?? style.borderWidth);
    }, 0);
    const minimumStrip = barBorders + (waveform.children.length - 1) * number(strip.gap);
    const availableStrip = width -
      number(content.paddingLeft ?? content.paddingHorizontal ?? content.padding) -
      number(content.paddingRight ?? content.paddingHorizontal ?? content.padding) -
      number(indent?.paddingLeft) -
      number(card.paddingLeft ?? card.paddingHorizontal ?? card.padding) -
      number(card.paddingRight ?? card.paddingHorizontal ?? card.padding) -
      number(card.borderLeftWidth ?? card.borderWidth) -
      number(card.borderRightWidth ?? card.borderWidth) -
      number(disc.width) - number(brow.gap);
    expect(waveform.children).toHaveLength(48);
    expect(minimumStrip).toBeLessThanOrEqual(availableStrip);
  });
});
