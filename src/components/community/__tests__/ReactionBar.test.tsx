import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ReactionBar from '../ReactionBar';
import {
  COMMUNITY_REACTION_BY_KIND,
  COMMUNITY_REACTION_EMOJI,
  communityApi,
  communityReactionDisplay,
  type CommunityReactionEmoji,
} from '../../../api/communityApi';
import api from '../../../services/api';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ semanticColors: lightTokens }) };
});

// Copy of growth-project-backend/src/community/reactions/community-emoji.allowlist.ts
// at a9713e8b: ReactDto accepts graphemes, NOT these named realtime kinds.
const BACKEND_REACTIONS = {
  like: '\u{1F44D}',
  fire: '\u{1F525}',
  family: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',
  love: '\u2764\uFE0F',
  celebrate: '\u{1F389}',
  strength: '\u{1F4AA}',
  clap: '\u{1F44F}',
  laugh: '\u{1F602}',
  wow: '\u{1F62E}',
  sad: '\u{1F622}',
};
const POST = '33333333-3333-3333-3333-333333333333';
const REMOVED = ['\u{1F3AF}', '\u{1F440}'];

beforeEach(() => {
  jest.clearAllMocks();
  (api.post as jest.Mock).mockResolvedValue({ data: {} });
  (api.delete as jest.Mock).mockResolvedValue({ data: {} });
});

it('pins the registry and every offered key to the backend REST allowlist', () => {
  expect(COMMUNITY_REACTION_BY_KIND).toEqual(BACKEND_REACTIONS);
  expect(COMMUNITY_REACTION_EMOJI).toEqual([
    BACKEND_REACTIONS.like, BACKEND_REACTIONS.fire, BACKEND_REACTIONS.strength,
    BACKEND_REACTIONS.love, BACKEND_REACTIONS.clap, BACKEND_REACTIONS.celebrate,
  ]);
  for (const emoji of COMMUNITY_REACTION_EMOJI) {
    expect(Object.values(BACKEND_REACTIONS)).toContain(emoji);
  }
});

it('offers only accepted quick reactions, including Love instead of target', async () => {
  const view = await render(<ReactionBar onToggle={jest.fn()} />);
  expect(view.getAllByRole('button')).toHaveLength(4);
  for (const emoji of COMMUNITY_REACTION_EMOJI.slice(0, 4)) {
    expect(view.getByTestId(`reaction-${emoji}`)).toBeTruthy();
  }
  for (const emoji of REMOVED) {
    expect(view.queryByTestId(`reaction-${emoji}`)).toBeNull();
  }
});

it.each(COMMUNITY_REACTION_EMOJI)('tapping offered key %s sends the accepted POST and DELETE bodies', async (emoji) => {
  const onToggle = jest.fn((key: CommunityReactionEmoji, active: boolean) =>
    active ? communityApi.unreactToPost(POST, key) : communityApi.reactToPost(POST, key));
  const view = await render(
    <ReactionBar quickEmoji={[emoji]} onToggle={onToggle} />,
  );
  await fireEvent.press(view.getByTestId(`reaction-${emoji}`));
  expect(onToggle).toHaveBeenCalledWith(emoji, false);
  expect(api.post).toHaveBeenCalledWith(`/community/posts/${POST}/reactions`, { emoji });
  await view.rerender(
    <ReactionBar quickEmoji={[emoji]} onToggle={onToggle}
      reactions={[{ emoji, count: 2, reacted_by_me: true }]} />,
  );
  expect(view.getByText(communityReactionDisplay(emoji))).toBeTruthy();
  await fireEvent.press(view.getByTestId(`reaction-${emoji}`));
  expect(onToggle).toHaveBeenLastCalledWith(emoji, true);
  expect(api.delete).toHaveBeenCalledWith(`/community/posts/${POST}/reactions`, { data: { emoji } });
});

it('shows raised hands but sends the backend celebration grapheme', async () => {
  const key = BACKEND_REACTIONS.celebrate;
  const onToggle = jest.fn();
  const view = await render(
    <ReactionBar quickEmoji={[]} onToggle={onToggle}
      reactions={[{ emoji: key, count: 7, reacted_by_me: true }]} />,
  );
  expect(view.getByText('\u{1F64C}')).toBeTruthy();
  expect(view.getByText('7')).toBeTruthy();
  await fireEvent.press(view.getByTestId(`reaction-${key}`));
  expect(onToggle).toHaveBeenCalledWith(key, true);
});

it('renders every accepted stored key as a real toggle, even outside the quick set', async () => {
  const onToggle = jest.fn();
  const view = await render(
    <ReactionBar quickEmoji={[]} onToggle={onToggle}
      reactions={Object.values(BACKEND_REACTIONS).map((emoji) =>
        ({ emoji, count: 1, reacted_by_me: false }))} />,
  );
  for (const emoji of Object.values(BACKEND_REACTIONS)) {
    await fireEvent.press(view.getByTestId(`reaction-${emoji}`));
    expect(onToggle).toHaveBeenLastCalledWith(emoji, false);
  }
});

it.each([...REMOVED, '\u{1F64C}', 'future-reaction'])('keeps unknown stored key %s and its count without a refused button', async (emoji) => {
  const onToggle = jest.fn();
  const view = await render(
    <ReactionBar quickEmoji={[]} onToggle={onToggle}
      reactions={[{ emoji, count: 9, reacted_by_me: true }]} />,
  );
  expect(view.getByText(emoji)).toBeTruthy();
  expect(view.getByText('9')).toBeTruthy();
  expect(view.queryAllByRole('button')).toHaveLength(0);
  expect(view.getByTestId(`reaction-${emoji}`).props.onPress).toBeUndefined();
  expect(onToggle).not.toHaveBeenCalled();
});
