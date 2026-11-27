/**
 * "Save a meal from today", the pure part (SAVED-MEAL-SAVE-M; the owner's PICK #ALM-P2, Style 2 Menu). Nothing here
 * reads, writes or stores anything. Today's foods are the server's (GET /log/daily), grouped by meal, newest meal
 * first (R3); a food's name, amount and numbers are the Food day's own (foodLogFromDailyEntry, formatPortion). The
 * body sent is built here only (R4), and so are the default name (R5), the limit (R8) and the lost-send match (R6).
 */
import type { SaveMealBody, SavedMeal } from '../../../api/savedFoodsApi';
import { formatTime } from '../../../calendar/calendarTime';
import type { MealType } from '../../../types';
import { foodLogFromDailyEntry, type DailyLogEntry } from '../../../utils/log/dailyEntry';
import { formatPortion } from '../../../utils/log/quickLog';
import { MEAL_SECTIONS } from '../../../utils/log/types';
import { foodsLine } from './kitchen';

/** The server's own limits (backend src/log/saved-foods.dto.ts:8-9, SAVED_MEALS_MAX and SAVED_MEAL_ITEMS_MAX). Its
 *  409 body drops `limit` (the error filter allows no detail for it), so the phone keeps its own 100 (R8). */
export const SAVED_MEALS_MAX = 100;
export const SAVED_MEAL_ITEMS_MAX = 30;
/** The name's MaxLength (dto :11-12, :46-50), counted on the trimmed name the phone sends. */
export const NAME_MAX = 80;
// LogFoodDto's bounds, which SavedMealItemDto repeats (backend src/log/log.dto.ts:19-56).
const MULTIPLIER = { min: 0.01, max: 50 };
const QUANTITY_MAX = 100000;
const UNIT_MAX = 32;

export interface DayFood {
  id: string;
  name: string;
  amount: string;
  kcal: number;
  protein: number;
  /** False when the multiplier is outside what a saved meal takes (KS-17): never ticked, never sent. */
  savable: boolean;
  entry: DailyLogEntry;
}
export interface DayGroup { meal: MealType; label: string; time: string | null; foods: DayFood[] }

/** A read is today's foods only when it is an object with an entries list; anything else is a failed read (SS5). */
export function todayEntries(data: unknown): DailyLogEntry[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const entries = (data as { entries?: unknown }).entries;
  return Array.isArray(entries) ? entries.filter((e): e is DailyLogEntry => !!e && typeof e === 'object' && typeof e.id === 'string') : null;
}

const stamp = (e: DailyLogEntry): string | null => e.logged_at || e.created_at || null;
const ms = (e: DailyLogEntry): number => { const t = Date.parse(stamp(e) ?? ''); return Number.isFinite(t) ? t : 0; };
/** "12:35 pm": the app's clock words, one plain space (ProgressV2.tsx:40; Intl may give a narrow no-break space). */
const clock = (iso: string): string => formatTime(new Date(iso)).replace(/\s+/g, ' ').toLowerCase();

const isSavable = (e: DailyLogEntry): boolean => {
  const m = e.quantity_multiplier;
  return typeof e.food_item_id === 'string' && e.food_item_id.length > 0 && typeof m === 'number' && Number.isFinite(m)
    && m >= MULTIPLIER.min && m <= MULTIPLIER.max;
};

function dayFood(e: DailyLogEntry): DayFood {
  const log = foodLogFromDailyEntry(e, '');
  return { id: e.id, name: log.foodName, amount: formatPortion(log.quantity, log.unit), kcal: log.calories, protein: log.protein,
    savable: isSavable(e), entry: e };
}

/** R3: the day's foods by meal, newest meal first; inside a meal, the day's order (the server's order kept for ties). */
export function dayGroups(entries: DailyLogEntry[]): DayGroup[] {
  const ordered = entries.map((e, i) => [e, i] as const).sort((a, b) => ms(a[0]) - ms(b[0]) || a[1] - b[1]).map(([e]) => e);
  const groups = new Map<string, DailyLogEntry[]>();
  for (const e of ordered) groups.set(e.meal_type, [...(groups.get(e.meal_type) ?? []), e]);
  const last = (list: DailyLogEntry[]) => Math.max(...list.map(ms));
  return [...groups.values()].sort((a, b) => last(b) - last(a)).map((list) => {
    const meal = list[0].meal_type as MealType;
    const newest = [...list].reverse().find((e) => stamp(e));
    const label = MEAL_SECTIONS.find((m) => m.type === meal)?.label ?? 'Snacks';
    return { meal, label, time: newest ? clock(stamp(newest) as string) : null, foods: list.map(dayFood) };
  });
}

/** KM-17: "Lunch, 12:35 pm" (drawn in capitals by the overline's style; read as written). */
export const groupTitle = (g: DayGroup): string => (g.time ? `${g.label}, ${g.time}` : g.label);

/** SS1: the newest meal's foods are ticked first (the ones a meal can hold). */
export const firstPicks = (groups: DayGroup[]): string[] => (groups[0]?.foods ?? []).filter((f) => f.savable).map((f) => f.id);

/** The picked foods in the day's order, whatever order she ticked them in (R4, R12). */
export function pickedFoods(groups: DayGroup[], picked: Iterable<string>): DayFood[] {
  const ids = new Set(picked);
  return groups.flatMap((g) => g.foods).filter((f) => f.savable && ids.has(f.id)).sort((a, b) => ms(a.entry) - ms(b.entry));
}

/** R5: each food's name up to its first comma, as stored, joined by the Kitchen's foods line, cut at a word end. */
export function defaultName(names: string[]): string {
  const line = foodsLine(names.map((n) => n.split(',')[0].trim()).filter(Boolean));
  if (line.length <= NAME_MAX) return line;
  const cut = line.slice(0, NAME_MAX + 1);
  const end = cut.lastIndexOf(' ');
  return (end > 0 ? cut.slice(0, end) : line.slice(0, NAME_MAX)).replace(/[\s,]+$/, '');
}

/** The server's name rule: 1 to 80 characters once trimmed, one of them visible. */
export const nameOk = (name: string): boolean => { const t = name.trim(); return t.length > 0 && t.length <= NAME_MAX && /\S/.test(t); };

/** R4: the one body. Every key is named here, so nothing else can reach the server (forbidNonWhitelisted). */
export function saveBody(name: string, foods: DayFood[]): SaveMealBody {
  return {
    name: name.trim(),
    items: foods.map(({ entry: e }) => {
      const qty = e.original_quantity;
      const unit = typeof e.original_unit === 'string' ? e.original_unit : '';
      const portion = typeof qty === 'number' && Number.isFinite(qty) && qty >= 0 && qty <= QUANTITY_MAX && unit.length > 0
        && unit.length <= UNIT_MAX;
      return portion
        ? { food_item_id: e.food_item_id, quantity_multiplier: e.quantity_multiplier, original_quantity: qty, original_unit: unit, meal_type: e.meal_type } /* MUTATION M1 */
        : { food_item_id: e.food_item_id, quantity_multiplier: e.quantity_multiplier };
    }),
  };
}

/** R8: the limit, from what the cache holds. */
export const atLimit = (meals: unknown[] | null): boolean => !!meals && meals.length >= SAVED_MEALS_MAX;

/** R6: a meal the server holds is a lost send when its trimmed name and its foods (id and multiplier, in order) match. */
export function matchesSend(meal: SavedMeal, body: SaveMealBody): boolean {
  const items = [...(Array.isArray(meal.items) ? meal.items : [])].sort((a, b) => a.position - b.position);
  return meal.name.trim() === body.name && items.length === body.items.length
    && items.every((it, i) => it.food_item_id === body.items[i].food_item_id
      && Math.abs(it.quantity_multiplier - body.items[i].quantity_multiplier) <= 1e-6);
}

/** R6: the meal a lost send of this sheet made, if the list now holds one it did not hold before the first send. */
export const lostSaveIn = (meals: SavedMeal[], kept: Set<string>, lost: SaveMealBody[]): SavedMeal | null =>
  meals.find((m) => !kept.has(m.id) && lost.some((body) => matchesSend(m, body))) ?? null;
