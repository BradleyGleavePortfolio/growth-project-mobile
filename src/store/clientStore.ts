import { create } from 'zustand';
import { logApi, waterApi, type WaterEntry } from '../services/api';
import { getTodayString } from '../utils/date';
import { MealType, FoodLog } from '../types';
import { logger } from '../utils/logger';
import { mapFoodItem, type RawFoodItem } from '../utils/log/mapFoodItem';

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
  waterEntries: WaterEntry[];
  hasLoadedDay: boolean;
  isLoading: boolean;
  loadError: string | null;

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
  removeWaterEntry: (entryId: string) => Promise<void>;
  // Drops an entry from the day on screen and takes its nutrition off the
  // day's totals straight away, before the server confirms the delete.
  removeFoodLogLocally: (entryId: string) => void;
  // Security: reset all in-memory state on logout so the next user on the
  // same device doesn't briefly see the previous user's food/water data.
  reset: () => void;
}

const initialClientState = {
  selectedDate: getTodayString(),
  foodLogs: [] as FoodLog[],
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0,
  waterEntries: [] as WaterEntry[],
  hasLoadedDay: false,
  isLoading: false,
  loadError: null as string | null,
};

export const useClientStore = create<ClientStore>((set, get) => ({
  ...initialClientState,

  setSelectedDate: (date: string) => set((state) => state.selectedDate === date ? {} : {
    selectedDate: date,
    foodLogs: [],
    dailyTotals: { ...initialClientState.dailyTotals },
    waterOz: 0,
    waterEntries: [],
    hasLoadedDay: false,
    loadError: null,
  }),

  reset: () => set({ ...initialClientState, selectedDate: getTodayString() }),

  loadDayData: async (_userId: string, date?: string) => {
    try {
      const d = date || get().selectedDate;
      get().setSelectedDate(d);
      set({ isLoading: true, loadError: null });

      // Fetch food logs and water in parallel
      const [foodResponse, waterResponse] = await Promise.all([
        logApi.getDaily(d),
        waterApi.getDaily(d).catch((err: unknown) => {
          logger.error('ClientStore', 'water data load failed', err);
          return null;
        }),
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
        food_item?: RawFoodItem;
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
          quantityMultiplier: e.quantity_multiplier,
          foodItem: e.food_item ? mapFoodItem(e.food_item) : undefined,
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
      const totalMl = waterResponse?.data?.total_ml || 0;
      const waterOz = waterResponse ? Math.round(totalMl / 29.5735) : get().waterOz;

      set({
        foodLogs: logs,
        dailyTotals: {
          calories: data.total_calories || 0,
          protein: data.total_protein_g || 0,
          carbs: data.total_carbs_g || 0,
          fat: data.total_fat_g || 0,
        },
        waterOz,
        waterEntries: waterResponse ? waterResponse.data.logs || [] : get().waterEntries,
        selectedDate: d,
        hasLoadedDay: true,
        isLoading: false,
        loadError: waterResponse
          ? null
          : 'Water data could not refresh. Check your connection and try again.',
      });
    } catch (err) {
      // Preserve data only for a refresh of the same selected day.
      logger.error('ClientStore', 'loadDayData failed', err);
      set({
        isLoading: false,
        loadError: 'Food and water data could not refresh. Check your connection and try again.',
      });
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

  removeFoodLogLocally: (entryId: string) =>
    set((state) => {
      const removed = state.foodLogs.find((f) => f.id === entryId);
      if (!removed) return {};
      const t = state.dailyTotals;
      return {
        foodLogs: state.foodLogs.filter((f) => f.id !== entryId),
        dailyTotals: {
          calories: Math.max(0, t.calories - removed.calories),
          protein: Math.max(0, t.protein - removed.protein),
          carbs: Math.max(0, t.carbs - removed.carbs),
          fat: Math.max(0, t.fat - removed.fat),
        },
      };
    }),

  logWater: async (_userId: string, _coachId: string, amountOz: number) => {
    // Optimistic update — add immediately, sync to backend
    set((state) => ({ waterOz: state.waterOz + amountOz }));
    try {
      const amountMl = Math.round(amountOz * 29.5735);
      const date = get().selectedDate;
      const response = await waterApi.log({ amount_ml: amountMl, date });
      if (response.data.id) {
        set((state) => ({ waterEntries: [...state.waterEntries, response.data] }));
      }
      set((state) => state.loadError?.endsWith(' oz of water was not saved. Check the connection, then add it again.')
        ? { loadError: null }
        : {});
    } catch (err) {
      // Revert the optimistic bump and say so: a number that silently goes
      // back down reads as a glitch, not as "this was not saved".
      logger.error('ClientStore', 'logWater failed', err);
      set((state) => ({
        waterOz: Math.max(0, state.waterOz - amountOz),
        loadError: `${amountOz} oz of water was not saved. Check the connection, then add it again.`,
      }));
    }
  },

  removeWaterEntry: async (entryId: string) => {
    await waterApi.deleteEntry(entryId);
    set((state) => {
      if (!state.waterEntries.some((entry) => entry.id === entryId)) return {};
      const waterEntries = state.waterEntries.filter((entry) => entry.id !== entryId);
      return {
        waterEntries,
        waterOz: Math.round(waterEntries.reduce((total, entry) => total + entry.amount_ml, 0) / 29.5735),
      };
    });
  },
}));
