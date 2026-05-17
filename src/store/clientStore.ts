import { create } from 'zustand';
import { logApi, waterApi } from '../services/api';
import { getTodayString } from '../utils/date';
import { MealType, FoodLog } from '../types';

interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface ClientStore {
  selectedDate: string;
  foodLogs: FoodLog[];
  dailyTotals: DailyTotals;
  waterOz: number;
  isLoading: boolean;

  setSelectedDate: (date: string) => void;
  loadDayData: (userId: string, date?: string) => Promise<void>;
  loadProfile: (userId: string) => Promise<void>;
  logFood: (data: {
    userId: string;
    date: string;
    mealType: MealType;
    foodItemId: string;
    quantityMultiplier?: number;
    notes?: string;
  }) => Promise<void>;
  logWater: (userId: string, coachId: string, amount: number) => Promise<void>;
  // Security: reset all in-memory state on logout so the next user on the
  // same device doesn't briefly see the previous user's food/water data.
  reset: () => void;
}

const initialClientState = {
  selectedDate: getTodayString(),
  foodLogs: [] as FoodLog[],
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0,
  isLoading: false,
};

export const useClientStore = create<ClientStore>((set, get) => ({
  ...initialClientState,

  setSelectedDate: (date: string) => set({ selectedDate: date }),

  reset: () => set({ ...initialClientState, selectedDate: getTodayString() }),

  loadDayData: async (_userId: string, date?: string) => {
    try {
      set({ isLoading: true });
      const d = date || get().selectedDate;

      // Fetch food logs and water in parallel
      const [foodResponse, waterResponse] = await Promise.all([
        logApi.getDaily(d),
        waterApi.getDaily(d).catch(() => ({ data: { total_ml: 0 } })),
      ]);
      const data = foodResponse.data;

      // Wire shape returned by /v1/log/daily.
      interface DailyLogEntry {
        id: string;
        food_item_id: string;
        user_id: string;
        meal_type: FoodLog['mealType'];
        quantity_multiplier: number;
        original_quantity?: number | null;
        original_unit?: string | null;
        logged_at?: string;
        created_at?: string;
        food_item?: {
          name?: string;
          calories?: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
        };
      }
      const entries = (data.entries || []) as DailyLogEntry[];
      // The existing mapping intentionally writes both `foodName` (the
      // canonical FoodLog field) and a duplicate `name` consumed by older
      // screens; FoodLog itself doesn't declare `name`, so we have to
      // double-cast through unknown to keep both shapes in flight without
      // re-introducing `any`.
      // TODO(types): drop the duplicate `name` field once all consumers
      // read `foodName` directly.
      const logs: FoodLog[] = entries.map<FoodLog>((e) => {
        // F-3 fix: surface original_quantity/original_unit so meal cards
        // can render "6 oz chicken" instead of the hardcoded
        // "1 serving" placeholder. Falls back to the multiplier when the
        // backend row is legacy and has no original_* fields.
        const hasOriginal =
          typeof e.original_quantity === 'number' &&
          !!e.original_unit &&
          (e.original_unit || '').trim().length > 0;
        return ({
          id: e.id,
          foodItemId: e.food_item_id,
          foodName: e.food_item?.name || '',
          name: e.food_item?.name || '',
          calories: Math.round((e.food_item?.calories || 0) * e.quantity_multiplier),
          protein: Math.round((e.food_item?.protein_g || 0) * e.quantity_multiplier),
          carbs: Math.round((e.food_item?.carbs_g || 0) * e.quantity_multiplier),
          fat: Math.round((e.food_item?.fat_g || 0) * e.quantity_multiplier),
          mealType: e.meal_type,
          date: d,
          quantity: hasOriginal
            ? (e.original_quantity as number)
            : e.quantity_multiplier,
          unit: hasOriginal ? (e.original_unit as string) : 'serving',
          originalQuantity:
            typeof e.original_quantity === 'number'
              ? e.original_quantity
              : undefined,
          originalUnit: e.original_unit ? e.original_unit : undefined,
          userId: e.user_id,
          coachId: '',
          createdAt: e.logged_at || e.created_at || new Date().toISOString(),
        } as FoodLog & { name: string });
      });

      // Convert ml to oz for display (1 oz = 29.5735 ml)
      const totalMl = waterResponse.data?.total_ml || 0;
      const waterOz = Math.round(totalMl / 29.5735);

      set({
        foodLogs: logs,
        dailyTotals: {
          calories: data.total_calories || 0,
          protein: data.total_protein_g || 0,
          carbs: data.total_carbs_g || 0,
          fat: data.total_fat_g || 0,
        },
        waterOz,
        selectedDate: d,
        isLoading: false,
      });
    } catch (err) {
      // Read-only day data aggregation. Empty totals are acceptable; the
      // UI falls back to zeros and the user can retry via pull-to-refresh.
      console.error('clientStore: loadDayData failed', err);
      set({ isLoading: false });
    }
  },

  loadProfile: async (_userId: string) => {
    // Profile is loaded from AsyncStorage macro_targets — nothing to do here
  },

  logFood: async (data) => {
    try {
      await logApi.logFood({
        date: data.date,
        meal_type: data.mealType,
        food_item_id: data.foodItemId,
        quantity_multiplier: data.quantityMultiplier || 1.0,
        notes: data.notes,
      });
      await get().loadDayData(data.userId, data.date);
    } catch (err) {
      throw err;
    }
  },

  logWater: async (_userId: string, _coachId: string, amountOz: number) => {
    // Optimistic update — add immediately, sync to backend
    set((state) => ({ waterOz: state.waterOz + amountOz }));
    try {
      const amountMl = Math.round(amountOz * 29.5735);
      const date = get().selectedDate;
      await waterApi.log({ amount_ml: amountMl, date });
    } catch (err) {
      // Revert optimistic bump on failure. We don't Alert here because
      // WaterTracker's UI shows the revert instantly; logging for telemetry
      // preserves visibility into transient failures.
      console.error('clientStore: logWater failed', err);
      set((state) => ({ waterOz: Math.max(0, state.waterOz - amountOz) }));
    }
  },
}));
