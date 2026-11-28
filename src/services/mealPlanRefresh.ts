/**
 * MEAL-PLAN-REFRESH-M: a meal plan notice (b#1250) marks every saved answer of the client's day stale (the plan
 * screen's and the Food day's keys, ['meal-plan', 'today', ...] in useMealTemplates.ts and FoodDayView.tsx) and
 * re-reads the ones on screen. It never drops a saved answer, so an offline client keeps what they had. Called where
 * a notice is received and where its tap is delivered. Its own file, importing only the app's queryClient: beside the
 * key in useMealTemplates.ts it made that hook load the client, which programsScreens.test.tsx's react-query mock
 * cannot build.
 */
import type { ClientTodayResponse } from '../api/mealTemplatesApi';
import { queryClient } from './queryClient';

export function refreshMealPlanToday(): void {
  void queryClient.invalidateQueries({ queryKey: ['meal-plan', 'today'] });
}

/**
 * MEALPLAN-RESUME-M (SWEEP-MEAL-PLANS B2): she is back in the app from the background (its icon, the app switcher, a
 * notice she did not tap). A coach's change made meanwhile reached the phone as a notice in the tray, which runs no
 * app code, or not at all with notifications off. So each plan read on screen (the Food day, the meal plan page, the
 * plan meal page, the Kitchen card, Food this week) is read once more with `read`, for its own day, and the answer
 * written. A read that fails writes nothing: refreshMealPlanToday's re-read would leave the saved answer in error, and
 * the Food day then draws its error block over the plan (FoodDayView.tsx plan.isError), so an offline return keeps
 * the plan she had with no error. A read already under way answers this return. An answer is written only into the
 * same saved read and never over a newer answer: sign-out empties the cache, so a late one never reaches the next
 * account. Called by the root sync mount (useFoodLogQueueSync.ts), which holds the read.
 */
export function rereadMealPlanOnScreen(read: (date?: string) => Promise<ClientTodayResponse>): void {
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({ queryKey: ['meal-plan', 'today'], type: 'active' })) {
    if (query.state.fetchStatus !== 'idle') continue;
    const asked = Date.now();
    const day = query.queryKey[2];
    read(typeof day === 'string' ? day : undefined).then((answer) => {
      if (cache.get(query.queryHash) !== query || query.state.dataUpdatedAt > asked) return;
      queryClient.setQueryData(query.queryKey, answer);
    }, () => undefined);
  }
}
