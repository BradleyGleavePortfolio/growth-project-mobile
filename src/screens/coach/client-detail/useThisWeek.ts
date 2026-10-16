/**
 * K1-OVERVIEW — This week's reads: the timeline (meals, check-ins, weigh-ins, sharing flags) and the calorie
 * target. Meals come 100 a page; a full page still inside the seven days reads the next (at most 5 more).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { coachApi } from '../../../services/api';
import { macrosApi } from '../../../api/macrosApi';
import { checkInWeek, foodWeek, needsNextMealPage, type CheckInRow, type MealRow } from './thisWeek';

export interface Sharing { workouts: boolean; food: boolean; weighIns: boolean; checkIns: boolean }
export type ThisWeekRead =
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'ok';
      sharing: Sharing;
      food: { logged: number; average: number | null };
      target: number | null;
      checkIns: { count: number; toReview: number };
      weighIns: number;
    };

type Consent = { workouts?: boolean; food_macros?: boolean; body_metrics?: boolean; habits_progress?: boolean } | undefined;

/** The server's sharing block; a missing flag reads as shared, as the summary does today. */
export const sharingOf = (c: Consent): Sharing => ({
  workouts: c?.workouts !== false, food: c?.food_macros !== false,
  weighIns: c?.body_metrics !== false, checkIns: c?.habits_progress !== false,
});

export function useThisWeek(clientId: string, on: boolean) {
  const [read, setRead] = useState<ThisWeekRead>({ kind: 'loading' });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setRead({ kind: 'loading' });
    const now = new Date();
    try {
      const target = macrosApi.currentForClient(clientId).then((r) => r.data?.calories_kcal ?? null, () => null);
      const first = (await coachApi.getClientTimeline(clientId, 90)).data;
      if (!first || first.error) throw new Error('timeline');
      const meals: MealRow[] = [...(first.meals ?? [])];
      let page: MealRow[] = meals;
      for (let more = 0; more < 5 && needsNextMealPage(page, now); more += 1) {
        page = (await coachApi.getClientTimeline(clientId, 90, page[page.length - 1].id)).data?.meals ?? [];
        meals.push(...page);
      }
      const kcal = await target;
      if (mine !== seq.current) return;
      setRead({
        kind: 'ok',
        sharing: sharingOf(first.consent),
        food: foodWeek(meals, now),
        target: kcal,
        checkIns: checkInWeek((first.checkIns ?? []) as CheckInRow[], now),
        weighIns: (first.weights ?? []).length,
      });
    } catch {
      if (mine === seq.current) setRead({ kind: 'error' });
    }
  }, [clientId]);

  // Once per client while the tab is open; Try again and pull-to-refresh call reload.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!on || loadedFor.current === clientId) return;
    loadedFor.current = clientId;
    void load();
  }, [on, clientId, load]);

  return { read, reload: load };
}
