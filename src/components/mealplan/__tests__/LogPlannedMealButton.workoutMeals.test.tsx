/**
 * PREWORKOUT-EATEN-M (SWEEP-FOOD-LOG B1): "Ate it as planned" on a pre-workout or post-workout plan meal logs it in one
 * tap, with no meal chooser, under the Food-day meal the eaten rule counts it under (utils/log/foodDay.ts LOG_MEAL:
 * Snacks; the server stores only breakfast, lunch, dinner and snack, backend src/log/log.dto.ts). For every plan meal
 * the button and the eaten rule name the same meal, so a meal logged from its own button is eaten and is not offered
 * again. Every switch on ([R27]): the plan link is sent only with the checklist on (utils/log/planLink.ts).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { foodApi, logApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import LogPlannedMealButton, { mealTypeForSlot, plannedMealFromSlot } from '../LogPlannedMealButton';
import { SLOT_LABELS, type DailyMealPlan, type DailyMealPlanSlot, type SlotLabel } from '../../../api/mealTemplatesApi';
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
jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true, offlineFoodInDay: true } };
});
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-07',
}));

const netinfo = jest.requireMock('@react-native-community/netinfo');
const CHOOSER = 'Choose the meal to add it to.';

const slotOf = (label: SlotLabel): DailyMealPlanSlot => ({
  id: `slot-${label}`, daily_meal_plan_id: 'plan-1', meal_template_id: 't1', slot_label: label, order: 0,
  meal_template: {
    id: 't1', coach_id: 'c1', name: 'Chocolate milk and a banana', description: null, calories_kcal: 310, protein_g: 16,
    carbs_g: 52, fats_g: 5, fiber_g: null, items: null, created_at: '2026-10-01', archived_at: null,
  },
});
const planOf = (slot: DailyMealPlanSlot): DailyMealPlan => ({
  id: 'plan-1', coach_id: 'c1', name: 'Training day', notes: null, created_at: '2026-10-01', archived_at: null, slots: [slot],
});
type Sent = { meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'; plan_slot_id?: string; quantity_multiplier: number };
const sentLog = () => jest.mocked(logApi.logFood).mock.calls[0][0] as Sent;
/** The entry as the server stores this write (log.service.ts logFood: meal_type as sent) and GET /log/daily returns it. */
const stored = (sent: Sent) => foodLogFromDailyEntry({
  id: 'entry-1', food_item_id: 'food-1', user_id: 'client-1', meal_type: sent.meal_type,
  quantity_multiplier: sent.quantity_multiplier, original_quantity: 1, original_unit: 'serving',
  plan_slot_id: sent.plan_slot_id ?? null, client_uuid: 'k1',
  food_item: { id: 'food-1', name: 'Chocolate milk and a banana', calories: 310, protein_g: 16, carbs_g: 52, fat_g: 5 },
}, '2026-10-07');

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.__reset();
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
});

describe('PREWORKOUT-EATEN-M: a plan meal logged from its own button is eaten', () => {
  it.each(SLOT_LABELS.map((l) => [l]))('%s: the button logs to the meal the eaten rule counts it under', (label) => {
    const slot = slotOf(label);
    expect(mealTypeForSlot(slot.slot_label)).toBe(buildPlanDay([planOf(slot)], []).slots[0].mealType);
  });

  it.each(SLOT_LABELS.map((l) => [l]))('%s: one tap, no chooser, and the plan meal is eaten', async (label) => {
    const slot = slotOf(label);
    await render(<LogPlannedMealButton meal={plannedMealFromSlot(slot)} slot={slot.slot_label} planSlotId={slot.id} planned />);
    await fireEvent.press(screen.getByText('Ate it as planned'));
    expect(screen.queryByText(CHOOSER)).toBeNull();
    await screen.findByText(/^Added to today's /);
    expect(logApi.logFood).toHaveBeenCalledTimes(1);
    const sent = sentLog();
    expect(sent.plan_slot_id).toBe(slot.id);
    const day = buildPlanDay([planOf(slot)], [stored(sent)]);
    expect(day.slots[0].logs).toHaveLength(1);
    expect(day.slots[0].status).toBe('Logged as planned');
    expect(day.extras).toHaveLength(0);
  });

  it('post-workout, online: one tap adds it to Snacks for its plan meal, with Undo', async () => {
    const slot = slotOf('postworkout');
    await render(<LogPlannedMealButton meal={plannedMealFromSlot(slot)} slot={slot.slot_label} planSlotId={slot.id} planned />);
    await fireEvent.press(screen.getByText('Ate it as planned'));
    expect(screen.queryByText(CHOOSER)).toBeNull();
    expect(await screen.findByText("Added to today's snacks.")).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
    expect(foodApi.create).toHaveBeenCalledTimes(1);
    expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-10-07', meal_type: 'snack', plan_slot_id: 'slot-postworkout', quantity_multiplier: 1,
    }));
  });

  it('post-workout, offline: one tap queues it under Snacks for its plan meal', async () => {
    netinfo.__setState({ isConnected: false });
    const slot = slotOf('postworkout');
    await render(<LogPlannedMealButton meal={plannedMealFromSlot(slot)} slot={slot.slot_label} planSlotId={slot.id} planned />);
    await fireEvent.press(screen.getByText('Ate it as planned'));
    expect(screen.queryByText(CHOOSER)).toBeNull();
    expect(await screen.findByText("Saved offline. It syncs to today's snacks when the connection returns.")).toBeTruthy();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'manual', log: expect.objectContaining({ date: '2026-10-07', meal_type: 'snack', plan_slot_id: 'slot-postworkout' }),
    }), expect.stringMatching(/^pfl_/));
    expect(logApi.logFood).not.toHaveBeenCalled();
  });
});
