/**
 * PHOTO-MOD-M: a reported photo in the coach's report queue.
 *
 * The queue item shape is backend main's (FX-1139 CONTRACT on b#1146): a photo
 * message keeps `target_type: "message"` and adds `image` (null once removed;
 * `url` null when storage could not sign it); `content` is the caption or "".
 * Covers: the thumbnail opens full size and closes; the four decisions stay on
 * a photo row and name "photo"; a captionless photo draws no empty line; no
 * link or a failed load shows the cannot-show notice (never a blank tile) and
 * never refetches on its own; a fresh link retries; a removed photo draws no
 * tile and reads "Removed"; text, voice and post rows are unchanged.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

type QueryStub = {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: jest.Mock;
};
const mockFlagged: { current: QueryStub } = {
  current: { data: [], isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() },
};
const mockModerate = jest.fn();
jest.mock('../../../hooks/useCoachCommunity', () => ({
  useCoachFlagged: () => mockFlagged.current,
  useModerateFlagged: () => ({ mutate: mockModerate, isPending: false }),
  useCoachEmptyStatePayload: () => ({
    status: 'ready',
    payload: {
      text: 'TEST_EMPTY_MODERATION_COPY',
      avatar_crop: 'smile',
      surface_key: 'coach_community_moderation_empty',
      voice_variant: 'roman_v2',
    },
  }),
}));

import CoachCommunityModerationScreen, {
  flaggedNoun,
} from '../CoachCommunityModerationScreen';
import { PHOTO_FAILED, PHOTO_HELP } from '../../../components/community/coach/FlaggedPhoto';
import type { CoachFlaggedItem } from '../../../api/coachCommunityApi';

const ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const URL_A = 'https://storage.example.test/photo-a?sig=1';
const URL_B = 'https://storage.example.test/photo-a?sig=2';

const item = (over: Record<string, unknown> = {}) => ({
  id: ID,
  target_type: 'message',
  target_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  content: '',
  author_name: 'Maya Patel',
  cohort_name: 'Spring block',
  reason: 'spam',
  removed: false,
  created_at: new Date(Date.now() - 7_200_000).toISOString(),
  image: {
    url: URL_A,
    width: 1200,
    height: 900,
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  },
  ...over,
});

function queue(items: unknown[]): void {
  mockFlagged.current = {
    data: items,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockModerate.mockReset();
});

describe('PHOTO-MOD-M — a reported photo in the report queue', () => {
  it('shows a thumbnail that opens the photo full size and closes again', async () => {
    queue([item()]);
    const { getByTestId, queryByTestId, getByText, getByLabelText } = await render(
      <CoachCommunityModerationScreen />,
    );
    const thumb = getByTestId(`coach-community-flagged-photo-${ID}-thumb`);
    expect(thumb.props.accessibilityLabel).toBe('Photo from Maya Patel');
    expect(getByTestId(`coach-community-flagged-photo-${ID}-image`).props.source).toEqual({
      uri: URL_A,
    });
    expect(getByText(PHOTO_HELP)).toBeTruthy();
    expect(getByText('Spring block · photo · Spam or scams')).toBeTruthy();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-full`)).toBeNull();

    await fireEvent.press(thumb);
    expect(getByTestId(`coach-community-flagged-photo-${ID}-full`).props.source).toEqual({
      uri: URL_A,
    });
    await fireEvent.press(getByLabelText('Close photo'));
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-full`)).toBeNull();
  });

  it('a captionless photo draws no empty text line; a caption still shows', async () => {
    queue([item()]);
    const first = await render(<CoachCommunityModerationScreen />);
    expect(first.queryByTestId(`coach-community-flagged-content-${ID}`)).toBeNull();
    first.unmount();

    queue([item({ content: 'Look at this' })]);
    const second = await render(<CoachCommunityModerationScreen />);
    expect(second.getByTestId(`coach-community-flagged-content-${ID}`)).toBeTruthy();
    expect(second.getByText('Look at this')).toBeTruthy();
    expect(second.getByTestId(`coach-community-flagged-photo-${ID}-thumb`)).toBeTruthy();
  });

  it.each(['dismiss', 'warn', 'hide', 'ban'] as const)(
    'a photo row keeps %s, behind the confirmation, naming the photo',
    async (action) => {
      queue([item()]);
      const { getByTestId, getByText } = await render(<CoachCommunityModerationScreen />);
      await fireEvent.press(getByTestId(`coach-community-flagged-${action}-${ID}`));
      expect(getByText(/this photo from Maya Patel/)).toBeTruthy();
      expect(mockModerate).not.toHaveBeenCalled();
      await fireEvent.press(getByTestId('coach-community-moderation-hide-confirm-confirm'));
      expect(mockModerate).toHaveBeenCalledWith(
        { item: expect.objectContaining({ id: ID, target_type: 'message' }), action },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    },
  );

  it('no link (storage could not sign it) shows the cannot-show notice, not a blank tile', async () => {
    queue([item({ image: { url: null, width: 1200, height: 900, expires_at: 'x' } })]);
    const { getByTestId, queryByTestId, getByText } = await render(
      <CoachCommunityModerationScreen />,
    );
    expect(getByTestId(`coach-community-flagged-photo-${ID}-failed`)).toBeTruthy();
    expect(getByText(PHOTO_FAILED)).toBeTruthy();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-thumb`)).toBeNull();
    // The decisions stay.
    expect(getByTestId(`coach-community-flagged-hide-${ID}`)).toBeTruthy();
  });

  it('a malformed image reads as cannot-show, never a blank tile or a crash', async () => {
    queue([item({ image: { url: 42 } })]);
    const { getByTestId, queryByTestId } = await render(<CoachCommunityModerationScreen />);
    expect(getByTestId(`coach-community-flagged-photo-${ID}-failed`)).toBeTruthy();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-thumb`)).toBeNull();
  });

  it('a failed load shows the notice, does not refetch on its own, and a fresh link retries', async () => {
    queue([item()]);
    const refetch = mockFlagged.current.refetch;
    const view = await render(<CoachCommunityModerationScreen />);
    await act(async () => {
      fireEvent(view.getByTestId(`coach-community-flagged-photo-${ID}-image`), 'error', {
        nativeEvent: { error: 'expired' },
      });
    });
    expect(view.getByTestId(`coach-community-flagged-photo-${ID}-failed`)).toBeTruthy();
    expect(refetch).not.toHaveBeenCalled();

    // Pull to refresh brings a new signed link: the tile tries again.
    queue([item({ image: { url: URL_B, width: 1200, height: 900, expires_at: 'x' } })]);
    await view.rerender(<CoachCommunityModerationScreen />);
    expect(view.getByTestId(`coach-community-flagged-photo-${ID}-image`).props.source).toEqual({
      uri: URL_B,
    });
  });

  it('a load failure in the full-size view closes it onto the notice', async () => {
    queue([item()]);
    const { getByTestId, queryByTestId } = await render(<CoachCommunityModerationScreen />);
    await fireEvent.press(getByTestId(`coach-community-flagged-photo-${ID}-thumb`));
    await act(async () => {
      fireEvent(getByTestId(`coach-community-flagged-photo-${ID}-full`), 'error', {
        nativeEvent: { error: 'expired' },
      });
    });
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-full`)).toBeNull();
    expect(getByTestId(`coach-community-flagged-photo-${ID}-failed`)).toBeTruthy();
  });

  it('a removed photo (image null) draws no tile and reads Removed, decisions kept', async () => {
    queue([item({ image: null, removed: true, content: 'Removed' })]);
    const { getByText, queryByTestId, getByTestId } = await render(
      <CoachCommunityModerationScreen />,
    );
    expect(getByText('Removed')).toBeTruthy();
    expect(getByText('Spring block · photo · Spam or scams')).toBeTruthy();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}`)).toBeNull();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-thumb`)).toBeNull();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-failed`)).toBeNull();
    expect(getByTestId(`coach-community-flagged-dismiss-${ID}`)).toBeTruthy();
  });

  it('removed wins over a stale image (key off removed first)', async () => {
    queue([item({ removed: true, content: 'Removed' })]);
    const { queryByTestId, getByText } = await render(<CoachCommunityModerationScreen />);
    expect(getByText('Removed')).toBeTruthy();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-thumb`)).toBeNull();
  });

  it('text, voice and post rows have no photo and keep their nouns', async () => {
    const text = item({ image: undefined, content: 'Plain words' });
    delete (text as Record<string, unknown>).image;
    queue([text]);
    const { queryByTestId, getByText } = await render(<CoachCommunityModerationScreen />);
    expect(getByText('Plain words')).toBeTruthy();
    expect(getByText('Spring block · message · Spam or scams')).toBeTruthy();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-thumb`)).toBeNull();
    expect(queryByTestId(`coach-community-flagged-photo-${ID}-failed`)).toBeNull();

    const base = { ...text } as unknown as CoachFlaggedItem;
    expect(flaggedNoun({ ...base, target_type: 'voice_note' })).toBe('voice note');
    expect(flaggedNoun({ ...base, target_type: 'post' })).toBe('post');
    expect(flaggedNoun({ ...base, target_type: 'win' })).toBe('win');
    // An `image` key only counts on a message.
    expect(
      flaggedNoun({ ...base, target_type: 'post', image: item().image } as CoachFlaggedItem),
    ).toBe('post');
  });
});
