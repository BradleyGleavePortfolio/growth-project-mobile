import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { mealTemplatesApi } from '../api/mealTemplatesApi';
import {
  readPendingFoodLogCount,
  subscribePendingFoodLogs,
  syncFoodLogQueue,
} from '../services/foodLogSync';
import { rereadMealPlanOnScreen } from '../services/mealPlanRefresh';

/** The plan read every reader of ['meal-plan', 'today', day] makes (FoodDayView.tsx, useMealTemplates.ts). */
const readPlanDay = (date?: string) => mealTemplatesApi.todayForClient(date).then((r) => r.data);

/**
 * Sends foods saved offline whenever they may finally reach the server:
 * when the signed-in client's app starts (including a cold start after the
 * app was closed offline), when the connection returns, and when the app
 * comes back to the foreground. Mounted once, by RootNavigator.
 *
 * MEALPLAN-RESUME-M: a return from the background also reads the meal plan on
 * screen once more (mealPlanRefresh.ts rereadMealPlanOnScreen), so a coach's
 * change made while the app was behind reaches the open Food day.
 */
export function useFoodLogQueueSync(signedInClient: boolean, online: boolean): void {
  const wasOnline = useRef(online);

  useEffect(() => {
    if (signedInClient) void syncFoodLogQueue();
  }, [signedInClient]);

  useEffect(() => {
    if (signedInClient && online && !wasOnline.current) void syncFoodLogQueue();
    wasOnline.current = online;
  }, [signedInClient, online]);

  useEffect(() => {
    if (!signedInClient) return undefined;
    // A glance at Control Centre or the app switcher (inactive and back) is not a return (TARGETS-REFRESH-M's rule).
    let away = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') away = true;
      if (state !== 'active') return;
      void syncFoodLogQueue();
      if (!away) return;
      away = false;
      rereadMealPlanOnScreen(readPlanDay);
    });
    return () => sub.remove();
  }, [signedInClient]);
}

/** Foods saved offline on this device that are not in the log yet. */
export function usePendingFoodLogCount(): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePendingFoodLogs((count) => {
      if (active) setPending(count);
    });
    void readPendingFoodLogCount().then((count) => {
      if (active) setPending(count);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return pending;
}
