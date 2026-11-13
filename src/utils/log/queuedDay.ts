// OFFLINE-FOOD-M (owner #191-E3): a food saved offline counts in its day at once.
//
// The day on screen is the server's day plus the foods on this phone for that day that the server
// does not hold yet. The join is the save's key: every queued food is sent with `client_uuid` = its
// queue id (foodLogQueue.flush), the server keeps that key on the entry and answers a resend of the
// same key with the entry it already stored (backend b#1209). So a queued food whose key is already
// on a server entry of the day is that entry: it is shown once, from the server. That covers a slow
// sync (the read lands before the queue drops the food) and a save that reached the server with the
// answer lost (the food stays queued; the next read already holds it).
//
// A food the server refused (parked) stays visible, marked, and is not counted: it is in no total
// until the member removes it and logs it again.
import type { FoodLog } from '../../types';
import type { WaterEntry } from '../../services/api';
import type { PendingFoodLog, PendingWaterWeightLog, QueuedFoodShown, SentWaterWeightLog } from '../../services/foodLogQueue';
import type { SearchResult } from './types';

export interface DayTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A food's name and per-unit macros (its own basis, as the server's food item holds them). */
export function shownFor(food: Pick<SearchResult, 'name' | 'calories' | 'protein' | 'carbs' | 'fat'>): QueuedFoodShown {
  const v = (n: number) => (Number.isFinite(n) ? n : null);
  return { name: food.name, calories: v(food.calories), protein_g: v(food.protein), carbs_g: v(food.carbs), fat_g: v(food.fat) };
}

function shownOf(item: PendingFoodLog): QueuedFoodShown | null {
  if (item.shown && item.shown.name) return item.shown;
  if (item.food && item.food.name) {
    const { name, calories, protein_g, carbs_g, fat_g } = item.food;
    return { name, calories, protein_g, carbs_g, fat_g };
  }
  return null;
}

/** The day row for one queued food, or null when the phone holds no name for it (older builds). */
export function queuedFoodLog(item: PendingFoodLog, userId: string): FoodLog | null {
  const shown = shownOf(item);
  if (!shown) return null;
  const m = Number.isFinite(item.log.quantity_multiplier) ? item.log.quantity_multiplier : 1;
  // Same rounding as the server's rows in clientStore.loadDayData: per-unit value x multiplier.
  const times = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * m) : 0);
  const hasOriginal = typeof item.log.original_quantity === 'number' && !!item.log.original_unit?.trim();
  return {
    id: item.id,
    clientUuid: item.id,
    offline: item.parkedAt ? 'refused' : 'waiting',
    userId,
    coachId: '',
    date: item.log.date,
    mealType: item.log.meal_type,
    foodName: shown.name,
    calories: times(shown.calories),
    protein: times(shown.protein_g),
    carbs: times(shown.carbs_g),
    fat: times(shown.fat_g),
    quantity: hasOriginal ? (item.log.original_quantity as number) : m,
    unit: hasOriginal ? (item.log.original_unit as string) : 'serving',
    originalQuantity: hasOriginal ? item.log.original_quantity : undefined,
    originalUnit: hasOriginal ? item.log.original_unit : undefined,
    quantityMultiplier: m,
    foodItemId: item.kind === 'search' ? item.foodItemId : undefined,
    planSlotId: item.log.plan_slot_id || undefined,
    fillsUsualMeal: item.log.fills_usual_meal === true || undefined,
    createdAt: new Date(item.createdAt || Date.now()).toISOString(),
  };
}

/**
 * The server's day for `date` with this phone's queued foods of that day added: waiting ones in the
 * list and the totals, refused ones in the list only. A queued food whose key a server row already
 * carries is not added again.
 */
export function withQueuedFoods(
  serverLogs: FoodLog[],
  serverTotals: DayTotals,
  queue: PendingFoodLog[],
  date: string,
  userId: string,
): { foodLogs: FoodLog[]; dailyTotals: DayTotals } {
  const onServer = new Set(serverLogs.map((l) => l.clientUuid).filter((k): k is string => !!k));
  const added: FoodLog[] = [];
  const totals = { ...serverTotals };
  for (const item of queue) {
    if (!item || !item.log || item.log.date !== date || onServer.has(item.id)) continue;
    // OFFLINE-WATER-WEIGHT-M (M2): a glass or a weigh-in is never a food of the day.
    if (item.kind !== 'search' && item.kind !== 'manual') continue;
    if (added.some((a) => a.id === item.id)) continue;
    const row = queuedFoodLog(item, userId);
    if (!row) continue;
    added.push(row);
    if (row.offline === 'waiting') {
      totals.calories += row.calories;
      totals.protein += row.protein;
      totals.carbs += row.carbs;
      totals.fat += row.fat;
    }
  }
  if (added.length === 0) return { foodLogs: serverLogs, dailyTotals: serverTotals };
  return { foodLogs: [...serverLogs, ...added], dailyTotals: totals };
}

/** True for a row that counts in the day's numbers (everything but a refused offline food). */
export const countsInDay = (log: FoodLog): boolean => log.offline !== 'refused';

/** OFFLINE-WATER-WEIGHT-M: a water entry as the water card lists it; a glass on this phone carries its state. */
export type ShownWaterEntry = WaterEntry & { offline?: 'waiting' | 'refused' };

const ML_PER_OZ = 29.5735;

/**
 * OFFLINE-WATER-WEIGHT-M (191-S5): the server's water read of `date` (its total and entries) with this phone's glasses
 * of that day added: a waiting glass, or a sent one whose answer id the read does not hold yet, is listed and counted;
 * a refused glass is listed (Remove) and counted nowhere. The join is the key: a sent glass is matched by the id its
 * answer carried (the day read has no client_uuid), never by amount or time. The queue and the sent list share one
 * id per glass, so it is added once.
 */
export function withQueuedWater(
  server: { totalMl: number; entries: WaterEntry[] },
  phone: (PendingWaterWeightLog | SentWaterWeightLog)[],
  date: string,
): { waterOz: number; waterEntries: ShownWaterEntry[] } {
  const onServer = new Set(server.entries.map((e) => e.id));
  const added: ShownWaterEntry[] = [];
  let ml = server.totalMl;
  for (const item of phone) {
    if (!item || item.kind !== 'water' || !item.log || item.log.date !== date) continue;
    const answerId = (item as SentWaterWeightLog).answerId;
    if ((answerId && onServer.has(answerId)) || added.some((a) => a.id === item.id)) continue;
    const offline = item.parkedAt ? 'refused' : 'waiting';
    added.push({ id: item.id, amount_ml: item.log.amount_ml, logged_at: new Date(item.createdAt || Date.now()).toISOString(), offline });
    if (offline === 'waiting') ml += item.log.amount_ml;
  }
  return { waterOz: Math.round(ml / ML_PER_OZ), waterEntries: added.length ? [...server.entries, ...added] : server.entries };
}
