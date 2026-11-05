/**
 * REMOVED-BY-M3 B-TEST: the line a coach-removed Hall post or comment shows, per viewer (backend #1176 CONTRACT
 * 6450153770 section 6; RB-W9 / RB-W10 owner #178-3, RB-W4 owner 10-26 "3.) b").
 */
import { removedRowLine } from '../removedRowLine';

const COACH = 'coach-1';
const AUTHOR = 'author-1';
const removed = {
  author_user_id: AUTHOR,
  removed_at: '2026-10-28T15:00:00.000Z',
  removed_by: { role: 'coach' as const, user_id: COACH, name: 'Maya' },
};

describe('removedRowLine', () => {
  it('tells the coach who removed it: You removed this post / comment (RB-W9)', () => {
    expect(removedRowLine(removed, 'post', COACH)).toEqual({ who: 'remover', text: 'You removed this post' });
    expect(removedRowLine(removed, 'comment', COACH)).toEqual({ who: 'remover', text: 'You removed this comment' });
  });

  it('tells the author: Your coach removed your post / comment (RB-W10)', () => {
    expect(removedRowLine(removed, 'post', AUTHOR)).toEqual({ who: 'author', text: 'Your coach removed your post' });
    expect(removedRowLine(removed, 'comment', AUTHOR)).toEqual({
      who: 'author',
      text: 'Your coach removed your comment',
    });
  });

  it('tells everyone else Removed by Coach {name} (RB-W4), or Removed by Coach when the name is blank', () => {
    expect(removedRowLine(removed, 'post', 'someone')).toEqual({ who: 'other', text: 'Removed by Coach Maya' });
    expect(removedRowLine(removed, 'comment', null)).toEqual({ who: 'other', text: 'Removed by Coach Maya' });
    const blank = { ...removed, removed_by: { ...removed.removed_by, name: '  ' } };
    expect(removedRowLine(blank, 'post', 'someone')).toEqual({ who: 'other', text: 'Removed by Coach' });
    expect(removedRowLine({ author_user_id: AUTHOR, removed_at: removed.removed_at }, 'post', 'x')).toEqual({
      who: 'other',
      text: 'Removed by Coach',
    });
  });

  it('is null on a live row, an author delete and an older server (no removed keys): today stays', () => {
    expect(removedRowLine({ author_user_id: AUTHOR }, 'post', COACH)).toBeNull();
    expect(removedRowLine({ author_user_id: AUTHOR }, 'comment', AUTHOR)).toBeNull();
  });
});
