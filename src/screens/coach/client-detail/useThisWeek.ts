/**
 * K1-OVERVIEW — This week's reads: the client's week (the masthead ring on every tab), the timeline's last 8 days
 * (meals, check-ins, sharing) and the calorie target. A full page of meals inside the seven days reads the next (5 more at most).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { coachApi } from '../../../services/api';
import { macrosApi } from '../../../api/macrosApi';
import { checkInWeek, foodWeek, needsNextMealPage, workoutWeek, type ClientWeek, type MealRow, type WorkoutWeek } from './thisWeek';

export interface Sharing { workouts: boolean; food: boolean; weighIns: boolean; checkIns: boolean }
export type ThisWeekRead =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ok'; sharing: Sharing; week: WorkoutWeek | null; food: { logged: number; average: number | null }; target: number | null; checkIns: { count: number; toReview: number } };

type Consent = { workouts?: boolean; food_macros?: boolean; body_metrics?: boolean; habits_progress?: boolean } | undefined;

/** The server's sharing block; a missing flag reads as shared, as the summary does today. */
export const sharingOf = (c: Consent): Sharing => ({
  workouts: c?.workouts !== false, food: c?.food_macros !== false,
  weighIns: c?.body_metrics !== false, checkIns: c?.habits_progress !== false,
});

/** `on`: the Style C file is showing. `active`: This week is the open tab. */
export function useThisWeek(clientId: string, on: boolean, active: boolean) {
  const [read, setRead] = useState<ThisWeekRead>({ kind: 'loading' });
  const seq = useRef(0);

  // `fresh` shows the placeholders first; a refresh keeps the cards on screen until the new read lands.
  const load = useCallback(async (fresh: boolean) => {
    const mine = ++seq.current;
    if (fresh) setRead({ kind: 'loading' });
    try {
      const [first, week, target] = await Promise.all([
        coachApi.getClientTimeline(clientId, 8).then((r) => r.data),
        coachApi.getClientWeek(clientId).then((r) => r.data as ClientWeek),
        macrosApi.currentForClient(clientId).then((r) => r.data?.calories_kcal ?? null, () => null),
      ]);
      if (!first || first.error) throw new Error('timeline');
      const meals: MealRow[] = [...(first.meals ?? [])];
      let page: MealRow[] = meals;
      for (let more = 0; more < 5 && needsNextMealPage(page, week.today); more += 1) {
        page = (await coachApi.getClientTimeline(clientId, 8, page[page.length - 1].id)).data?.meals ?? [];
        meals.push(...page);
      }
      if (mine !== seq.current) return;
      setRead({
        kind: 'ok', sharing: sharingOf(first.consent), week: workoutWeek(week), target,
        food: foodWeek(meals, week.today), checkIns: checkInWeek(first.checkIns ?? [], week.week_start),
      });
    } catch {
      if (mine === seq.current) setRead({ kind: 'error' });
    }
  }, [clientId]);

  // The first read per client; then again each time This week opens, so a check-in marked reviewed or a target
  // saved elsewhere in the file shows here at once. Try again and pull-to-refresh call retry and refresh.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!on || (!active && loadedFor.current === clientId)) return;
    const fresh = loadedFor.current !== clientId;
    loadedFor.current = clientId;
    void load(fresh);
  }, [on, active, clientId, load]);

  return { read, retry: () => load(true), refresh: () => load(false) };
}
