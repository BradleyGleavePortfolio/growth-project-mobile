import { featureFlags } from '../../config/featureFlags';

/** FOODLINK: what a food is logged for on the Food tab's day: a coach's plan meal, or a usual-day meal. */
export interface PlanLink {
  planSlotId?: string;
  fillsUsualMeal?: boolean;
}

/**
 * The plan link fields for a food log write, sent only while featureFlags.foodPlanChecklist is on: a backend
 * without FOODLINK answers an unknown field with a 400, which would park a queued entry on the phone.
 */
export const planLink = ({ planSlotId, fillsUsualMeal }: PlanLink = {}) =>
  featureFlags.foodPlanChecklist
    ? { ...(planSlotId ? { plan_slot_id: planSlotId } : {}), ...(fillsUsualMeal ? { fills_usual_meal: true } : {}) }
    : {};
