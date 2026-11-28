/**
 * SWEEP-FOOD-LOG B1 (B-TEST, fails at 50ff9b2e). A pre-workout (or post-workout) plan meal logged through its own
 * "Ate it as planned" on the plan meal page (PlanMealScreen.tsx:247) or the meal plan page
 * (ClientDailyMealPlanScreen.tsx:382) must tick that plan meal. LogPlannedMealButton gets slot="preworkout",
 * mealTypeForSlot() names no meal, so the sheet asks her to choose one, with none chosen. The Food day's eaten rule
 * (utils/log/foodDay.ts buildPlanDay) links a log to a pre-workout meal only under Snacks (LOG_MEAL). Any other choice
 * logs the meal and leaves it un-ticked on the Food day, the meal plan page and the plan meal page, which offer
 * "Ate it as planned" again: the same meal logged twice.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { foodApi, logApi } from '../../../services/api';
import LogPlannedMealButton, { plannedMealFromSlot } from '../LogPlannedMealButton';
import type { DailyMealPlan, DailyMealPlanSlot, SlotLabel } from '../../../api/mealTemplatesApi';
import { buildPlanDay } from '../../../utils/log/foodDay';
import { foodLogFromDailyEntry } from '../../../utils/log/dailyEntry';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../store/clientStore', () => ({
  useClientStore: { getState: () => ({ selectedDate: '2026-10-07', refreshShownDay: jest.fn() }) },
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
// Every switch on ([R27]): the plan link is sent only with the checklist on (utils/log/planLink.ts).
jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true, offlineFoodInDay: true } };
});
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-07',
}));

const netinfo = jest.requireMock('@react-native-community/netinfo');

const slotOf = (label: SlotLabel): DailyMealPlanSlot => ({
  id: `slot-${label}`, daily_meal_plan_id: 'plan-1', meal_template_id: 't1', slot_label: label, order: 0,
  meal_template: {
    id: 't1', coach_id: 'c1', name: 'Banana and whey', description: null, calories_kcal: 260, protein_g: 27,
    carbs_g: 30, fats_g: 3, fiber_g: null, items: null, created_at: '2026-10-01', archived_at: null,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.__reset();
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
});

describe('SWEEP-FOOD-LOG B1: a workout plan meal logged through its own button ticks that meal', () => {
  it.each(['preworkout', 'postworkout'] as SlotLabel[])(
    'a %s plan meal logged from "Ate it as planned", to the meal she picks, is eaten on the Food day',
    async (label) => {
      const slot = slotOf(label);
      await render(<LogPlannedMealButton meal={plannedMealFromSlot(slot)} slot={slot.slot_label} planSlotId={slot.id} planned />);
      await fireEvent.press(screen.getByText('Ate it as planned'));
      // The sheet (if any) shows the meals; a 6 am pre-workout meal is breakfast to her.
      if (screen.queryByText('Breakfast')) await fireEvent.press(screen.getByText('Breakfast'));
      const send = screen.queryByText(/^Log to /);
      if (send) await fireEvent.press(send);
      await screen.findByText(/^Added to today's /);

      expect(logApi.logFood).toHaveBeenCalledTimes(1);
      const sent = jest.mocked(logApi.logFood).mock.calls[0][0] as { meal_type: string; plan_slot_id?: string; quantity_multiplier: number };
      expect(sent.plan_slot_id).toBe(slot.id);
      // The server stores the entry as sent (log.service.ts logFood) and GET /log/daily returns it; the Food day,
      // the meal plan page and the plan meal page all decide "eaten" with buildPlanDay over that read.
      const log = foodLogFromDailyEntry({
        id: 'entry-1', food_item_id: 'food-1', user_id: 'client-1', meal_type: sent.meal_type as 'snack',
        quantity_multiplier: sent.quantity_multiplier, original_quantity: 1, original_unit: 'serving',
        plan_slot_id: sent.plan_slot_id ?? null, client_uuid: 'k1',
        food_item: { id: 'food-1', name: 'Banana and whey', calories: 260, protein_g: 27, carbs_g: 30, fat_g: 3 },
      }, '2026-10-07');
      const plan: DailyMealPlan = { id: 'plan-1', coach_id: 'c1', name: 'Plan', notes: null, created_at: '2026-10-01', archived_at: null, slots: [slot] };
      const day = buildPlanDay([plan], [log]);
      const meal = day.slots.find((x) => x.key === slot.id);
      expect(meal?.logs).toHaveLength(1);
      expect(day.extras).toHaveLength(0);
    },
  );
});
