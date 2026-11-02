/**
 * LS-910R3 C1, found not fixed: this PR changes tests, not account-deletion cleanup. Its deletion pass
 * checks MARK rows, not all QUEUE rows. Keep the existing boundary explicit using the real app readers.
 * This is a passing observation, not a new blocking requirement or a cleanup fix.
 */
import { setUserCache, clearUserCache } from '../lib/userCache';
import { READERS } from '../../test/savedKeyLifetimes/savedKeyReaders';
import { lifetimeFindings } from './savedKeyLifetimes.test';

const A = 'acct-a-1111';
const checked = [
  'async coach_consult_v1:{uid}',
  'async mwb_autosave_mirror:*',
  'async tgp.voiceOutbox.v1',
  'secure-store consult_draft.{uid}.*',
];

describe('LS-910R3 C1 existing deletion boundary is not called a cleanup fix', () => {
  it('coach answers remain readable after deletion while autosave, voice and encrypted draft controls are removed', async () => {
    // The last phase of lifetimeFindings seeds A, renders the real deletion screen, waits for logout,
    // then checks all MARK rows. No extra seed after that deletion is permitted in this observation.
    expect(await lifetimeFindings()).toEqual([]);
    const restored: Record<string, boolean> = {};
    try {
      for (const name of checked) {
        await setUserCache({ id: A, role: 'coach', name: 'A' } as Parameters<typeof setUserCache>[0]);
        restored[name] = await READERS[name].read(A);
      }
      expect(restored).toEqual({
        'async coach_consult_v1:{uid}': true,
        'async mwb_autosave_mirror:*': false,
        'async tgp.voiceOutbox.v1': false,
        'secure-store consult_draft.{uid}.*': false,
      });
    } finally {
      await clearUserCache();
    }
  });
});
