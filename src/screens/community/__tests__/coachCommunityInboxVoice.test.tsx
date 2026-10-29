/**
 * CoachCommunityInboxScreen — VOICE-INBOX (#167-4): a client's voice note is
 * an inbox row behind `featureFlags.communityVoiceNotes`.
 *
 * The flag is read once at module scope, so this file pins it ON before the
 * screen is imported (coachCommunityInboxFlagOff.test.tsx pins it OFF).
 *   - the voice row shows the Voice B Studio card (deep disc, flat bars, the
 *     length under them), the client's name and time, and says "Voice note ·
 *     0:42" to a screen reader; the typed row next to it is unchanged;
 *   - tapping the voice row opens CommunityVoiceNoteDetail for that note;
 *     tapping a typed row opens nothing (as today); a voice row has no ack;
 *   - getInbox keeps voice rows (with their note) only with the flag on; an
 *     older server's rows (no kind field) stay typed rows. With the flag off
 *     coachCommunityApi.test.ts shows voice rows are skipped.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { forestPop, voiceShades } from '../../../theme/tokens';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      communityVoiceNotes: true,
      communityAcks: true,
      communityAiTriage: false,
    },
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));

jest.mock('../../../hooks/useCoachCommunity', () => ({
    useCoachInbox: () => mockInbox,
    useCoachEmptyStatePayload: () => ({ status: 'loading' }),
    useCoachAckState: () => undefined,
    useCoachOwnedCohortIds: () => null,
}));

jest.mock('../../../hooks/useCoachAckActions', () => ({
  useCoachAckActions: () => ({
    markSeen: { mutate: jest.fn(), isPending: false, error: null },
    markAcked: { mutate: jest.fn(), isPending: false, error: null },
    markReplied: { mutate: jest.fn(), isPending: false, error: null },
  }),
  isIllegalAckTransition: () => false,
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

import api from '../../../services/api';
import CoachCommunityInboxScreen from '../CoachCommunityInboxScreen';
import { coachCommunityApi, type CoachInboxItem } from '../../../api/coachCommunityApi';

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
  type: 'message',
  kind: 'text',
  ...over,
});

const textRow = () => row({});
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
    data: { items: [textRow(), voiceRow()] },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
});

describe('CoachCommunityInboxScreen — voice rows (flag on)', () => {
  it('shows the voice row with its voice card, its length, name and time', async () => {
    const { getByTestId, getByText, queryByText } = await render(<CoachCommunityInboxScreen />);
    expect(getByTestId(`coach-community-inbox-row-${VOICE_ID}`)).toBeTruthy();
    expect(getByTestId(`coach-community-inbox-voice-${VOICE_ID}`, { includeHiddenElements: true })).toBeTruthy();
    expect(getByTestId(`coach-community-inbox-mark-acked-${TEXT_ID}`)).toBeTruthy();
    // GOAL B-05a / B-09a: the length sits under the bars; the row says "Voice note · 0:42" aloud only.
    expect(queryByText(/Voice note · 0:42/u)).toBeNull();
    expect(getByTestId(`coach-community-inbox-voice-time-${VOICE_ID}`, { includeHiddenElements: true }).props.children).toBe('0:42');
    expect(getByText('Sam Lee')).toBeTruthy();
    expect(getByText('Quick question about my plan')).toBeTruthy();
    // The coach inbox label also says the row's time in words (FIN-868R5 C3).
    expect(getByTestId(`coach-community-inbox-row-${VOICE_ID}`).props.accessibilityLabel).toMatch(
      /^Sam Lee in Spring block, [^:]+(:[0-9]{2} [ap]m)?: Voice note · 0:42$/,
    );
  });

  it('keeps the typed row as it is (no mic glyph); a voice row has no ack', async () => {
    const { queryByTestId } = await render(<CoachCommunityInboxScreen />);
    expect(queryByTestId(`coach-community-inbox-voice-${TEXT_ID}`)).toBeNull();
    expect(queryByTestId(`coach-community-inbox-mark-acked-${VOICE_ID}`)).toBeNull();
  });

  // FR-865R4 (Opus R3 m#884 B4 voice row, Sol R3 B4, Opus C2): the row carries the Voice B Studio card the
  // feed's player draws (white card, hairline, 52 pt deep disc with the leaf play mark, bars, the length
  // under the bars). The inbox sends no loudness, so the bars are the player's flat baseline: none invented.
  it('draws the Studio voice card: 52 pt deep disc, flat bars, length under the bars', async () => {
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    const hidden = { includeHiddenElements: true };
    const card = StyleSheet.flatten(getByTestId(`coach-community-inbox-voice-${VOICE_ID}`, hidden).props.style);
    expect(card).toMatchObject({ borderRadius: 16, borderWidth: 1, borderColor: voiceShades.hairline });
    const disc = StyleSheet.flatten(getByTestId(`coach-community-inbox-voice-disc-${VOICE_ID}`, hidden).props.style);
    expect(disc).toMatchObject({ width: 52, height: 52, backgroundColor: forestPop.deep });
    const bars = getByTestId(`coach-community-inbox-voice-bars-${VOICE_ID}`, hidden);
    const heights = bars.children.map((b) => StyleSheet.flatten((b as { props: { style: never } }).props.style).height);
    expect(heights.length).toBe(48);
    expect(new Set(heights)).toEqual(new Set([4]));
    const time = StyleSheet.flatten(getByTestId(`coach-community-inbox-voice-time-${VOICE_ID}`, hidden).props.style);
    expect(time).toMatchObject({ paddingLeft: 64, fontSize: 14 });
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

describe('getInbox with the voice flag on', () => {
  const wire = (id: string, extra: Record<string, unknown>) => ({
    id,
    type: 'message',
    cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    cohort_name: 'Spring',
    author_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    author_display_name: 'Dana',
    preview: 'Hi coach',
    created_at: '2026-10-22T09:00:00.000Z',
    ...extra,
  });

  it('keeps a voice row with its note, drops one with no note, keeps an older server row as text', async () => {
    jest.mocked(api.get).mockResolvedValueOnce({
      data: {
        items: [
          wire(VOICE_ID, { preview: 'Voice note', kind: 'voice', voice: { note_id: VOICE_ID, duration_ms: 42_000 } }),
          wire('44444444-4444-4444-4444-444444444444', { kind: 'voice' }),
          wire(TEXT_ID, {}),
        ],
        next_cursor: null,
      },
    });
    const res = await coachCommunityApi.getInbox();
    expect(res.items.map((i) => [i.id, i.kind])).toEqual([
      [VOICE_ID, 'voice'],
      [TEXT_ID, 'text'],
    ]);
    expect(res.items[0].voice).toEqual({ note_id: VOICE_ID, duration_ms: 42_000 });
  });
});

// FR-865R4: the Studio voice card (m#865) replaced round 2's strip; the card itself is what screen readers skip, so
// the row stays one element that says "…: Voice note · 0:42".
describe('FR-868 round 2 — the voice row is one accessible element', () => {
  it('no accessible element wraps the pressable voice row, and the voice card is hidden from screen readers', async () => {
    const { getByTestId } = await render(<CoachCommunityInboxScreen />);
    const row = getByTestId(`coach-community-inbox-row-${VOICE_ID}`);
    let node = row.parent;
    while (node) {
      expect(node.props.accessible).not.toBe(true);
      expect(node.props.accessibilityRole).not.toBe('button');
      node = node.parent;
    }
    const card = getByTestId(`coach-community-inbox-voice-${VOICE_ID}`, { includeHiddenElements: true });
    let hidden = false;
    let up: typeof card | null = card;
    while (up && up !== row) {
      if (up.props.accessibilityElementsHidden === true) hidden = true;
      up = up.parent;
    }
    expect(hidden).toBe(true);
  });
});
