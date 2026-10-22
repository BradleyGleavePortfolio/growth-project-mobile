/**
 * CoachCommunityInboxScreen — VOICE-INBOX (#167-4): a client's voice note is
 * an inbox row behind `featureFlags.communityVoiceNotes`.
 *
 * The flag is read once at module scope, so this file pins it ON before the
 * screen is imported (coachCommunityInboxFlagOff.test.tsx pins it OFF).
 *   - the voice row shows a mic glyph, "Voice note · 0:42", the client's name
 *     and time; the typed row next to it is unchanged;
 *   - tapping the voice row opens CommunityVoiceNoteDetail for that note;
 *     tapping a typed row opens nothing (as today);
 *   - visibleInboxItems drops voice rows with the flag off, and an older
 *     server's rows (no kind field) all stay typed rows.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      communityVoiceNotes: true,
      communityAcks: false,
      communityAiTriage: false,
    },
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockAckMutate = jest.fn();
jest.mock('../../../hooks/useCoachCommunity', () => {
  const actual = jest.requireActual('../../../hooks/useCoachCommunity');
  return {
    coachCommunityKeys: actual.coachCommunityKeys,
    useCoachInbox: () => mockInbox,
    useAckInboxItem: () => ({ mutate: mockAckMutate, isPending: false }),
    useCoachEmptyStatePayload: () => ({ status: 'loading' }),
    useCoachAckState: () => undefined,
  };
});

jest.mock('../../../hooks/useCoachAckActions', () => ({
  useCoachAckActions: () => ({
    markSeen: { mutate: jest.fn(), isPending: false, error: null },
    markAcked: { mutate: jest.fn(), isPending: false, error: null },
    markReplied: { mutate: jest.fn(), isPending: false, error: null },
  }),
  isIllegalAckTransition: () => false,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => undefined,
    setQueryData: () => undefined,
  }),
}));

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import CoachCommunityInboxScreen, {
  visibleInboxItems,
} from '../CoachCommunityInboxScreen';
import type { CoachInboxItem } from '../../../api/coachCommunityApi';

const TEXT_ID = '11111111-1111-1111-1111-111111111111';
const VOICE_ID = '22222222-2222-2222-2222-222222222222';

const row = (over: Partial<CoachInboxItem>): CoachInboxItem => ({
  id: TEXT_ID,
  cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  cohort_name: 'Spring block',
  client_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  client_name: 'Dana Cruz',
  avatar_url: null,
  snippet: 'Quick question about my plan',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  acknowledged: false,
  ...over,
});

const textRow = () => row({ kind: 'text' });
const voiceRow = () =>
  row({
    id: VOICE_ID,
    client_name: 'Sam Lee',
    snippet: 'Voice note',
    kind: 'voice',
    voice: { note_id: VOICE_ID, duration_ms: 42_000 },
  });

let mockInbox: unknown;

beforeEach(() => {
  mockNavigate.mockClear();
  mockInbox = {
    data: { items: [textRow(), voiceRow()], next_before: null },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
});

describe('CoachCommunityInboxScreen — voice rows (flag on)', () => {
  it('shows the voice row with a mic glyph, its length, name and time', async () => {
    const { getByTestId, getByText } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId(`coach-community-inbox-row-${VOICE_ID}`)).toBeTruthy();
    expect(getByTestId(`coach-community-inbox-voice-${VOICE_ID}`)).toBeTruthy();
    expect(getByText('Voice note · 0:42')).toBeTruthy();
    expect(getByText('Sam Lee')).toBeTruthy();
    expect(getByText('Quick question about my plan')).toBeTruthy();
    expect(getByTestId(`coach-community-inbox-row-${VOICE_ID}`).props.accessibilityLabel).toBe(
      'Sam Lee in Spring block: Voice note · 0:42',
    );
  });

  it('keeps the typed row as it is (no mic glyph)', async () => {
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(queryByTestId(`coach-community-inbox-voice-${TEXT_ID}`)).toBeNull();
  });

  it('opens the voice note when the voice row is tapped', async () => {
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    await fireEvent.press(getByTestId(`coach-community-inbox-row-${VOICE_ID}`));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('CommunityVoiceNoteDetail', {
      voiceNoteId: VOICE_ID,
    });
  });

  it('a typed row tap opens nothing, as today', async () => {
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    await fireEvent.press(getByTestId(`coach-community-inbox-row-${TEXT_ID}`));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('visibleInboxItems', () => {
  it('drops voice rows with the flag off and keeps typed rows', () => {
    const out = visibleInboxItems([textRow(), voiceRow()], false);
    expect(out.map((i) => i.id)).toEqual([TEXT_ID]);
  });

  it('keeps an older server page (no kind field) as typed rows, unchanged', () => {
    const legacy = row({});
    expect(visibleInboxItems([legacy], true)).toEqual([legacy]);
  });

  it('drops a voice row that has no note to open', () => {
    const broken = row({ id: VOICE_ID, kind: 'voice', snippet: 'Voice note' });
    expect(visibleInboxItems([textRow(), broken], true).map((i) => i.id)).toEqual([TEXT_ID]);
  });

  it('keeps paging order and labels the voice row with its length', () => {
    const out = visibleInboxItems([voiceRow(), textRow()], true);
    expect(out.map((i) => i.id)).toEqual([VOICE_ID, TEXT_ID]);
    expect(out[0].snippet).toBe('Voice note · 0:42');
  });
});
