/**
 * Day 1 Win "Skip for now", remembered per user on this device.
 *
 * GET /me/first-win/status only turns `completed` true when a win card is
 * tapped, so a client who tapped "Skip for now" used to get the full-screen
 * Day One interstitial again on every app open. RootNavigator now reads this
 * marker before asking the server, so a skip holds for that account on this
 * device. The key carries the user id, so another account on the same phone
 * still sees its own Day One screen once.
 */
import { prefsStorage } from '../storage/mmkv';
import { logger } from '../utils/logger';
import { readUserCache } from './userCache';

export const DAY1_WIN_SKIPPED_KEY_BASE = 'onboarding.day1win_skipped_at';

function keyFor(userId: string): string {
  return `${DAY1_WIN_SKIPPED_KEY_BASE}:${userId}`;
}

/**
 * Records that this user skipped the Day 1 Win screen. Falls back to the
 * cached signed-in user when the screen had no id yet. Never throws.
 */
export async function markDay1WinSkipped(userId: string | null | undefined): Promise<void> {
  try {
    let id = typeof userId === 'string' && userId ? userId : null;
    if (!id) {
      const cached = await readUserCache();
      id = typeof cached?.id === 'string' && cached.id ? cached.id : null;
    }
    if (!id) return;
    await prefsStorage.set(keyFor(id), new Date().toISOString());
  } catch (err) {
    logger.warn('day1WinSkip', 'skip marker not saved', err);
  }
}

/** True when this user already skipped the Day 1 Win screen on this device. */
export async function wasDay1WinSkipped(userId: string | null | undefined): Promise<boolean> {
  if (typeof userId !== 'string' || !userId) return false;
  try {
    return !!(await prefsStorage.getStringAsync(keyFor(userId)));
  } catch (err) {
    logger.warn('day1WinSkip', 'skip marker not read', err);
    return false;
  }
}
