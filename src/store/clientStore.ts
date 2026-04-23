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

      // Map entries to FoodLog shape
      const logs: FoodLog[] = (data.entries || []).map((e: any) => ({
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
        quantity: e.quantity_multiplier,
        unit: 'serving',
        userId: e.user_id,
        coachId: '',
      }));

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
    } catch {
      // Revert on failure
      set((state) => ({ waterOz: Math.max(0, state.waterOz - amountOz) }));
    }
  },
}));
