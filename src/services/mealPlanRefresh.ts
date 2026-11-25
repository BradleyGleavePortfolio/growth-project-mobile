/**
 * MEAL-PLAN-REFRESH-M: a meal plan notice (b#1250) marks every saved answer of the client's day stale (the plan
 * screen's and the Food day's keys, ['meal-plan', 'today', ...] in useMealTemplates.ts and FoodDayView.tsx) and
 * re-reads the ones on screen. It never drops a saved answer, so an offline client keeps what they had. Called where
 * a notice is received and where its tap is delivered. Its own file, importing only the app's queryClient: beside the
 * key in useMealTemplates.ts it made that hook load the client, which programsScreens.test.tsx's react-query mock
 * cannot build.
 */
import { queryClient } from './queryClient';

export function refreshMealPlanToday(): void {
  void queryClient.invalidateQueries({ queryKey: ['meal-plan', 'today'] });
}
