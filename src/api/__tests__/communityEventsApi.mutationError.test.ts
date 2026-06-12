/**
 * describeMutationError — calm, surfaced mutation-failure mapping (F4).
 *
 * Every failed RSVP / create / transition / replay / reflect passes its caught
 * error here so the screen can show something honest instead of failing
 * silently. A 409 maps to `conflict: true` (the event moved underneath the
 * caller) so the screen reconciles by refetching; everything else maps to a
 * calm, specific message with `conflict: false`.
 */
import { CommunityApiError } from '../communityApi';
import { describeMutationError } from '../communityEventsApi';

describe('describeMutationError (F4)', () => {
  it('classifies a 409 as a conflict that prompts a refetch', () => {
    const err = new CommunityApiError('conflict', 409, 'conflict');
    const info = describeMutationError(err);
    expect(info.conflict).toBe(true);
    expect(info.message).toMatch(/just changed|refreshed/i);
  });

  it('surfaces an unauthorized failure calmly (no conflict)', () => {
    const info = describeMutationError(
      new CommunityApiError('unauthorized', 401, 'unauthorized'),
    );
    expect(info.conflict).toBe(false);
    expect(info.message).toMatch(/session|sign in/i);
  });

  it('surfaces a forbidden failure calmly', () => {
    const info = describeMutationError(
      new CommunityApiError('forbidden', 403, 'forbidden'),
    );
    expect(info.conflict).toBe(false);
    expect(info.message).toMatch(/permission/i);
  });

  it('surfaces a server failure calmly', () => {
    const info = describeMutationError(
      new CommunityApiError('server', 500, 'server'),
    );
    expect(info.conflict).toBe(false);
    expect(info.message).toMatch(/our end|went wrong/i);
  });

  it('falls back to a calm generic message for an unknown error', () => {
    const info = describeMutationError(new Error('boom'));
    expect(info.conflict).toBe(false);
    expect(info.message.length).toBeGreaterThan(0);
  });
});
